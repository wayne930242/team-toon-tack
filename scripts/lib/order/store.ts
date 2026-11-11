/**
 * Work order files: `<.ttt>/orders/<project>/<code>.toon`.
 *
 * Every change is lock, read, mutate, write-to-temp, rename, so a crash leaves
 * either the old file or the new one, and two writers cannot interleave.
 * Callers do their remote work outside `updateOrder` and persist each result
 * with a short update.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { decode, encode } from "@toon-format/toon";
import { getPaths, type LocalConfig } from "../../utils.js";
import {
	addTickets,
	assertAcceptsTickets,
	assertSegment,
	localDate,
	newOrder,
	nextCode,
	parseOrderId,
	type Stamp,
	validateOrder,
} from "./model.js";
import { OrderError, type WorkOrder } from "./types.js";

const LOCK_WAIT_MS = 10_000;
const LOCK_RETRY_MS = 50;
/** No critical section does more than local file work, so an old lock is a dead one. */
const LOCK_STALE_MS = 30_000;

function ordersDir(): string {
	return path.join(getPaths().baseDir, "orders");
}

function orderPath(id: string): string {
	const { project, code } = parseOrderId(id);
	return path.join(ordersDir(), project, `${code}.toon`);
}

/** Project used when none is named: the directory that holds `.ttt`. */
export function defaultProject(): string {
	const name = path.basename(path.dirname(getPaths().baseDir));
	try {
		assertSegment(name, "project");
	} catch {
		throw new OrderError(
			`Cannot derive a project name from "${name}"; pass --project <name>.`,
		);
	}
	return name;
}

/** The writer's name in `owner` and the log: TTT_ACTOR, else user@host. */
export function resolveActor(localConfig: LocalConfig): string {
	if (process.env.TTT_ACTOR) return process.env.TTT_ACTOR;
	const user = Array.isArray(localConfig.current_user)
		? localConfig.current_user[0]
		: localConfig.current_user;
	return `${user || os.userInfo().username}@${os.hostname()}`;
}

export function stampFor(localConfig: LocalConfig): Stamp {
	return { by: resolveActor(localConfig), at: new Date().toISOString() };
}

async function withProjectLock<T>(
	project: string,
	fn: () => Promise<T>,
): Promise<T> {
	const dir = path.join(ordersDir(), project);
	await fs.mkdir(dir, { recursive: true });
	const lockPath = path.join(dir, ".lock");
	const deadline = Date.now() + LOCK_WAIT_MS;

	const token = `${process.pid}@${os.hostname()} ${new Date().toISOString()} ${Math.random().toString(36).slice(2)}\n`;
	const isStale = (file: string) =>
		fs
			.stat(file)
			.then((stat) => Date.now() - stat.mtimeMs > LOCK_STALE_MS)
			.catch(() => false);

	for (;;) {
		try {
			const handle = await fs.open(lockPath, "wx");
			await handle.writeFile(token);
			await handle.close();
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (await isStale(lockPath)) {
				await takeOverStaleLock(lockPath, isStale);
				continue;
			}
			if (Date.now() > deadline) {
				const holder = await fs.readFile(lockPath, "utf8").catch(() => "");
				throw new OrderError(
					`Orders of project ${project} are locked by ${holder.trim() || "another process"} (${lockPath}). Retry in a moment.`,
				);
			}
			await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
		}
	}

	try {
		return await fn();
	} finally {
		// Release only our own lock: if it went stale, another process owns it now
		const current = await fs.readFile(lockPath, "utf8").catch(() => "");
		if (current === token) await fs.rm(lockPath, { force: true });
	}
}

/**
 * Move a stale lock aside under a unique name before deleting it, so two
 * processes that both saw it stale cannot delete a fresh lock between them.
 * If what got moved turns out to be fresh, it goes back.
 */
async function takeOverStaleLock(
	lockPath: string,
	isStale: (file: string) => Promise<boolean>,
): Promise<void> {
	const aside = `${lockPath}.${process.pid}.${Math.random().toString(36).slice(2)}.stale`;
	try {
		await fs.rename(lockPath, aside);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	if (!(await isStale(aside))) {
		// Another process locked in between: restore its lock unless a third
		// one already holds the path
		await fs.link(aside, lockPath).catch(() => undefined);
	}
	await fs.rm(aside, { force: true });
}

async function readOrderFile(id: string): Promise<WorkOrder | undefined> {
	let content: string;
	try {
		content = await fs.readFile(orderPath(id), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	let order: WorkOrder;
	try {
		order = validateOrder(decode(content, { strict: true }));
	} catch (error) {
		throw new OrderError(
			`${orderPath(id)}: ${error instanceof Error ? error.message : error}`,
		);
	}
	if (order.id !== id) {
		throw new OrderError(
			`${orderPath(id)} holds order ${order.id}, not ${id}; the file was moved or edited by hand.`,
		);
	}
	return order;
}

/** Write atomically; call only while holding the project lock. */
async function writeOrderFile(order: WorkOrder): Promise<WorkOrder> {
	// validateOrder also puts the fields in one fixed order and drops unset ones
	const next = validateOrder({ ...order, rev: order.rev + 1 });
	const file = orderPath(next.id);
	const temp = `${file}.${process.pid}.tmp`;
	await fs.writeFile(temp, encode(next), "utf8");
	await fs.rename(temp, file);
	return next;
}

export async function loadOrder(id: string): Promise<WorkOrder> {
	const order = await readOrderFile(id);
	if (!order) {
		throw new OrderError(
			`Order ${id} not found in ${ordersDir()}. 'ttt order list --all' shows the orders on this machine; 'ttt order import <file>' brings one in.`,
		);
	}
	return order;
}

async function listProjects(): Promise<string[]> {
	const entries = await fs
		.readdir(ordersDir(), { withFileTypes: true })
		.catch(() => []);
	return entries
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort();
}

async function listCodes(project: string): Promise<string[]> {
	const files = await fs
		.readdir(path.join(ordersDir(), project))
		.catch(() => [] as string[]);
	return files
		.filter((f) => f.endsWith(".toon"))
		.map((f) => f.slice(0, -".toon".length))
		.sort();
}

/** Every order of one project, or of all projects, oldest code first. */
export async function listOrders(project?: string): Promise<WorkOrder[]> {
	if (project) assertSegment(project, "project");
	const projects = project ? [project] : await listProjects();
	const orders: WorkOrder[] = [];
	for (const name of projects) {
		for (const code of await listCodes(name)) {
			orders.push(await loadOrder(`${name}/${code}`));
		}
	}
	return orders;
}

/** The project's order that still takes tickets on this machine, if any. */
function findOpenOrder(orders: WorkOrder[]): WorkOrder | undefined {
	return orders.filter((o) => o.stage === "open" && !o.handed_off).at(-1);
}

/**
 * Lock, read, mutate, write. `mutate` throws an OrderError to refuse, or
 * returns false when it changed nothing; neither writes.
 */
export async function updateOrder(
	id: string,
	mutate: (order: WorkOrder) => unknown,
): Promise<WorkOrder> {
	const { project } = parseOrderId(id);
	return withProjectLock(project, async () => {
		const order = await loadOrder(id);
		if (mutate(order) === false) return order;
		return writeOrderFile(order);
	});
}

export interface OpenOrderOptions {
	project: string;
	/** Omit for the next `<date>-<letter>` code */
	code?: string;
	reviewer?: string;
}

/** Create an order. A project holds one open order at a time. */
export async function openOrder(
	options: OpenOrderOptions,
	stamp: Stamp,
): Promise<WorkOrder> {
	assertSegment(options.project, "project");
	return withProjectLock(options.project, async () => {
		const existing = await listOrders(options.project);
		const open = findOpenOrder(existing);
		if (open) {
			throw new OrderError(
				`Project ${options.project} already has an open order, ${open.id}. Seal it before opening the next one ('ttt order seal ${open.id} --gated-head <sha>').`,
			);
		}
		const code =
			options.code ??
			nextCode(
				existing.map((o) => parseOrderId(o.id).code),
				localDate(new Date(stamp.at)),
			);
		const id = `${options.project}/${code}`;
		if (existing.some((o) => o.id === id)) {
			throw new OrderError(`Order ${id} already exists.`);
		}
		return writeOrderFile(newOrder(id, stamp, options.reviewer));
	});
}

/** Where `ttt claim --order <target>` would put its tickets. */
export interface ClaimTarget {
	/** `auto`, or an order id */
	order: string;
	/** Project for `auto`; an order id carries its own */
	project?: string;
}

function claimProject(target: ClaimTarget): string {
	if (target.order !== "auto") return parseOrderId(target.order).project;
	return target.project ?? defaultProject();
}

/** A ticket rides one train at a time, per project. */
function assertTicketsFree(
	orders: WorkOrder[],
	targetId: string | undefined,
	ticketIds: string[],
): void {
	for (const other of orders) {
		if (other.id === targetId || other.stage === "closed") continue;
		const busy = other.tickets.filter(
			(t) => ticketIds.includes(t.id) && t.state !== "dropped",
		);
		if (busy.length > 0) {
			throw new OrderError(
				`${busy.map((t) => t.id).join(", ")} already in order ${other.id}. Drop it there first ('ttt order drop ${other.id} <ticket> --reason ...').`,
			);
		}
	}
}

/**
 * Before `review` adopts tickets into `orderId`: none of them may ride
 * another order of the same project. Orders of other projects do not count.
 */
export async function assertFreeForOrder(
	orderId: string,
	ticketIds: string[],
): Promise<void> {
	const { project } = parseOrderId(orderId);
	assertTicketsFree(await listOrders(project), orderId, ticketIds);
}

/**
 * Check, before any ticket is claimed, that the target can take these
 * tickets. Returns the order id, or null when `auto` will open a new order.
 */
export async function checkClaimTarget(
	target: ClaimTarget,
	ticketIds: string[],
): Promise<string | null> {
	const project = claimProject(target);
	if (target.order !== "auto" && target.project && target.project !== project) {
		throw new OrderError(
			`--project ${target.project} does not match order ${target.order}.`,
		);
	}
	const existing = await listOrders(project);
	let id: string | null;
	if (target.order === "auto") {
		id = findOpenOrder(existing)?.id ?? null;
	} else {
		assertAcceptsTickets(await loadOrder(target.order));
		id = target.order;
	}
	assertTicketsFree(existing, id ?? undefined, ticketIds);
	return id;
}

/** Add claimed tickets to the target order, opening one for `auto` if needed. */
export async function addClaimedTickets(
	target: ClaimTarget,
	ticketIds: string[],
	stamp: Stamp,
): Promise<{ order: WorkOrder; added: string[]; created: boolean }> {
	const project = claimProject(target);
	return withProjectLock(project, async () => {
		const existing = await listOrders(project);
		let order: WorkOrder | undefined;
		if (target.order === "auto") {
			order = findOpenOrder(existing);
		} else {
			order = await loadOrder(target.order);
		}
		const created = !order;
		if (!order) {
			const code = nextCode(
				existing.map((o) => parseOrderId(o.id).code),
				localDate(new Date(stamp.at)),
			);
			order = newOrder(`${project}/${code}`, stamp);
		}

		assertTicketsFree(existing, order.id, ticketIds);
		const added = addTickets(order, ticketIds, stamp);
		if (!created && added.length === 0) return { order, added, created };
		return { order: await writeOrderFile(order), added, created };
	});
}

/** Store an imported copy; `adopt` decides against the local copy, if any. */
export async function saveImported(
	id: string,
	adopt: (local: WorkOrder | undefined) => WorkOrder,
): Promise<WorkOrder> {
	const { project } = parseOrderId(id);
	return withProjectLock(project, async () => {
		const local = await readOrderFile(id);
		const order = adopt(local);
		// Keep revisions moving forward on this machine
		return writeOrderFile({
			...order,
			rev: Math.max(order.rev, local?.rev ?? 0),
		});
	});
}
