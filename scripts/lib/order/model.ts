/**
 * Work order rules. Every function here is pure apart from mutating the order
 * it is handed; reading, locking, and writing live in store.ts.
 */
import {
	ORDER_STAGES,
	OrderError,
	type OrderLogEntry,
	type OrderTestRun,
	type OrderTicket,
	TICKET_STATES,
	type WorkOrder,
} from "./types.js";

/** Who is writing, and when. */
export interface Stamp {
	by: string;
	at: string;
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA = /^[0-9a-f]{7,40}$/i;

export function assertSegment(value: string, what: string): void {
	if (!SEGMENT.test(value)) {
		throw new OrderError(
			`Invalid ${what} "${value}": use letters, digits, ".", "_" or "-", starting with a letter or digit.`,
		);
	}
}

export function assertSha(value: string, flag: string): void {
	if (!SHA.test(value)) {
		throw new OrderError(
			`${flag} expects a commit SHA (7-40 hex characters), got "${value}".`,
		);
	}
}

export function parseOrderId(id: string): { project: string; code: string } {
	const parts = id.split("/");
	if (parts.length !== 2) {
		throw new OrderError(
			`Invalid order id "${id}": expected <project>/<code>, e.g. app/2026-11-11-a.`,
		);
	}
	const [project, code] = parts;
	assertSegment(project, "project");
	assertSegment(code, "order code");
	return { project, code };
}

/** a, b, ... z, aa, ab, ... */
function letterAt(index: number): string {
	let n = index;
	let letters = "";
	do {
		letters = String.fromCharCode(97 + (n % 26)) + letters;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return letters;
}

/** The next `<date>-<letter>` code not used by `existingCodes`. */
export function nextCode(existingCodes: string[], date: string): string {
	const taken = new Set(existingCodes);
	for (let index = 0; ; index++) {
		const code = `${date}-${letterAt(index)}`;
		if (!taken.has(code)) return code;
	}
}

export function localDate(now: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function log(order: WorkOrder, stamp: Stamp, event: string): void {
	order.log.push({ at: stamp.at, by: stamp.by, event });
}

export function newOrder(
	id: string,
	stamp: Stamp,
	reviewer?: string,
): WorkOrder {
	parseOrderId(id);
	const order: WorkOrder = {
		id,
		owner: stamp.by,
		...(reviewer ? { reviewer } : {}),
		stage: "open",
		rev: 0,
		train: {},
		tickets: [],
		log: [],
	};
	log(order, stamp, "opened");
	return order;
}

/** Can this copy be changed at all? */
export function assertWritable(order: WorkOrder): void {
	if (order.handed_off) {
		throw new OrderError(
			`Order ${order.id} was handed off by ${order.handed_off.by} at ${order.handed_off.at}; this copy is read-only. ` +
				`When it comes back, import the returned copy ('ttt order import <file>'), or take this copy back with 'ttt order reclaim ${order.id}'.`,
		);
	}
	if (order.stage === "closed") {
		throw new OrderError(
			`Order ${order.id} is closed (merged ${order.train.merged_commit ?? "?"}) and takes no more changes. ` +
				`Open the next one with 'ttt order open' or 'ttt claim <id> --order auto'.`,
		);
	}
}

/** Can this copy take a new ticket? */
export function assertAcceptsTickets(order: WorkOrder): void {
	assertWritable(order);
	if (order.stage !== "open") {
		throw new OrderError(
			`Order ${order.id} is ${order.stage} and takes no more tickets. ` +
				`'ttt claim <id> --order auto' puts the ticket in the project's next order.`,
		);
	}
}

export function findTicket(
	order: WorkOrder,
	ticketId: string,
): OrderTicket | undefined {
	return order.tickets.find((t) => t.id === ticketId);
}

function requireTicket(order: WorkOrder, ticketId: string): OrderTicket {
	const ticket = findTicket(order, ticketId);
	if (!ticket) {
		throw new OrderError(
			`${ticketId} is not in order ${order.id}. Add it with 'ttt claim ${ticketId} --order ${order.id}'.`,
		);
	}
	return ticket;
}

/**
 * Put tickets in the order as in-progress. A ticket already there is left as
 * it is; a dropped one comes back. Returns the IDs that changed.
 */
export function addTickets(
	order: WorkOrder,
	ticketIds: string[],
	stamp: Stamp,
): string[] {
	assertAcceptsTickets(order);
	const added: string[] = [];
	for (const id of ticketIds) {
		const existing = findTicket(order, id);
		if (existing && existing.state !== "dropped") continue;
		if (existing) {
			existing.state = "in-progress";
			delete existing.reason;
		} else {
			order.tickets.push({ id, state: "in-progress", tests: [] });
		}
		added.push(id);
	}
	if (added.length > 0) log(order, stamp, `added ${added.join(", ")}`);
	return added;
}

/**
 * Parse `<command> [@ <sha>] [= <result>]`. The SHA defaults to the ticket's
 * head and the result to "pass". Separators need a space on both sides, so a
 * command may itself contain "@" or "=".
 */
export function parseTestRun(
	text: string,
	defaultSha: string | undefined,
	at: string,
): OrderTestRun {
	let rest = text.trim();
	let result = "pass";
	let sha = defaultSha;

	const resultAt = rest.lastIndexOf(" = ");
	if (resultAt !== -1) {
		result = rest.slice(resultAt + 3).trim();
		rest = rest.slice(0, resultAt).trim();
	}
	const shaAt = rest.lastIndexOf(" @ ");
	if (shaAt !== -1) {
		sha = rest.slice(shaAt + 3).trim();
		rest = rest.slice(0, shaAt).trim();
	}

	if (!rest || !result) {
		throw new OrderError(
			`--tests expects "<command> [@ <sha>] [= <result>]", got "${text}".`,
		);
	}
	if (!sha) {
		throw new OrderError(
			`--tests "${text}" names no commit: add " @ <sha>" or record the ticket's --head first.`,
		);
	}
	assertSha(sha, "--tests @");
	return { command: rest, sha, result, at };
}

export interface TicketFields {
	branch?: string;
	mr?: string;
	head?: string;
	review?: string;
	/** Raw `--tests` values; each appends one run record */
	tests?: string[];
}

export function setTicket(
	order: WorkOrder,
	ticketId: string,
	fields: TicketFields,
	stamp: Stamp,
): OrderTicket {
	assertWritable(order);
	const ticket = requireTicket(order, ticketId);
	if (ticket.state === "dropped") {
		throw new OrderError(
			`${ticketId} was dropped from order ${order.id}. Bring it back with 'ttt claim ${ticketId} --order ${order.id}' first.`,
		);
	}
	if (fields.head !== undefined) assertSha(fields.head, "--head");
	// Parse every run before changing anything, so a bad value changes nothing
	const head = fields.head ?? ticket.head;
	const runs = (fields.tests ?? []).map((text) =>
		parseTestRun(text, head, stamp.at),
	);

	const changed: string[] = [];
	for (const key of ["branch", "mr", "head", "review"] as const) {
		const value = fields[key];
		if (value !== undefined) {
			ticket[key] = value;
			changed.push(key);
		}
	}
	if (runs.length > 0) {
		ticket.tests.push(...runs);
		changed.push(`tests+${runs.length}`);
	}
	if (changed.length === 0) {
		throw new OrderError(
			"Nothing to record: pass at least one of --branch, --mr, --head, --review, --tests.",
		);
	}
	log(order, stamp, `set ${ticketId}: ${changed.join(", ")}`);
	return ticket;
}

/** Tickets that `review` may move: every one must be active in the order. */
export function assertReviewable(order: WorkOrder, ticketIds: string[]): void {
	assertWritable(order);
	for (const id of ticketIds) {
		const ticket = findTicket(order, id);
		if (!ticket) {
			// An open order adopts a ticket named at review; a sealed one is fixed
			assertAcceptsTickets(order);
		} else if (ticket.state === "dropped" || ticket.state === "done") {
			throw new OrderError(
				`${id} is ${ticket.state} in order ${order.id} and cannot go to review.`,
			);
		}
	}
}

export function markInReview(
	order: WorkOrder,
	ticketIds: string[],
	stamp: Stamp,
): void {
	assertReviewable(order, ticketIds);
	const missing = ticketIds.filter((id) => !findTicket(order, id));
	if (missing.length > 0) addTickets(order, missing, stamp);
	for (const id of ticketIds) {
		requireTicket(order, id).state = "in-review";
	}
	if (ticketIds.length > 0) {
		log(order, stamp, `in review: ${ticketIds.join(", ")}`);
	}
}

export function setTrain(
	order: WorkOrder,
	fields: { branch?: string; mr?: string },
	stamp: Stamp,
): void {
	assertWritable(order);
	if (fields.branch === undefined && fields.mr === undefined) {
		throw new OrderError("Nothing to record: pass --branch and/or --mr.");
	}
	if (fields.branch !== undefined) order.train.branch = fields.branch;
	if (fields.mr !== undefined) order.train.mr = fields.mr;
	log(
		order,
		stamp,
		`train: ${[
			fields.branch !== undefined ? `branch ${fields.branch}` : "",
			fields.mr !== undefined ? `mr ${fields.mr}` : "",
		]
			.filter(Boolean)
			.join(", ")}`,
	);
}

/** Fix the batch on a gated head. Sealing again records a new gated head. */
export function sealOrder(
	order: WorkOrder,
	gatedHead: string,
	stamp: Stamp,
): void {
	assertWritable(order);
	assertSha(gatedHead, "--gated-head");
	if (order.stage === "merged") {
		throw new OrderError(
			`Order ${order.id} is already merged (${order.train.merged_commit}); finish it with 'ttt order close ${order.id}'.`,
		);
	}
	const unfinished = order.tickets.filter((t) => t.state === "in-progress");
	if (unfinished.length > 0) {
		const ids = unfinished.map((t) => t.id).join(" ");
		throw new OrderError(
			`Cannot seal ${order.id}: ${ids} still in progress. ` +
				`Send them to review ('ttt order review ${order.id} ${ids}') or leave them out ('ttt order drop ${order.id} <ticket> --reason ...').`,
		);
	}
	if (!order.tickets.some((t) => t.state === "in-review")) {
		throw new OrderError(
			`Cannot seal ${order.id}: it has no ticket in review.`,
		);
	}
	const resealed = order.stage === "sealed";
	order.stage = "sealed";
	order.train.gated_head = gatedHead;
	log(order, stamp, `${resealed ? "resealed" : "sealed"} at ${gatedHead}`);
}

export function dropTicket(
	order: WorkOrder,
	ticketId: string,
	reason: string,
	stamp: Stamp,
): void {
	assertWritable(order);
	const ticket = requireTicket(order, ticketId);
	if (ticket.state === "done") {
		throw new OrderError(
			`${ticketId} is already done in order ${order.id}; it cannot be dropped.`,
		);
	}
	if (!reason.trim()) {
		throw new OrderError("drop needs --reason <text>.");
	}
	ticket.state = "dropped";
	ticket.reason = reason;
	log(order, stamp, `dropped ${ticketId}: ${reason}`);
}

/** Mark this copy read-only: its content now travels with the export. */
export function handOff(order: WorkOrder, stamp: Stamp): void {
	assertWritable(order);
	order.handed_off = { at: stamp.at, by: stamp.by };
	log(order, stamp, "handed off");
}

export function reclaim(order: WorkOrder, stamp: Stamp): void {
	if (!order.handed_off) {
		throw new OrderError(
			`Order ${order.id} is not handed off; this copy is already writable.`,
		);
	}
	delete order.handed_off;
	order.owner = stamp.by;
	log(order, stamp, "reclaimed");
}

/**
 * Take an imported copy as this machine's writable order. A local copy is
 * replaced only when it was handed off (or with `force`), and never by an
 * older revision.
 */
export function adoptImported(
	incoming: WorkOrder,
	local: WorkOrder | undefined,
	stamp: Stamp,
	force: boolean,
): WorkOrder {
	if (local && !force) {
		if (!local.handed_off) {
			throw new OrderError(
				`Order ${incoming.id} already exists here as a writable copy (owner ${local.owner}, rev ${local.rev}). ` +
					`Importing would overwrite it; pass --force to replace it.`,
			);
		}
		if (incoming.rev < local.rev) {
			throw new OrderError(
				`The imported copy of ${incoming.id} (rev ${incoming.rev}) is older than the local one (rev ${local.rev}). ` +
					`Import a newer export, take the local copy back with 'ttt order reclaim ${incoming.id}', or pass --force.`,
			);
		}
	}
	const previousOwner = incoming.owner;
	const order: WorkOrder = { ...incoming, owner: stamp.by };
	delete order.handed_off;
	log(order, stamp, `imported from ${previousOwner}`);
	return order;
}

/**
 * Record the train's merge. Asking again with the same commit changes
 * nothing; returns whether the order changed.
 */
export function recordMerge(
	order: WorkOrder,
	mergedCommit: string | undefined,
	version: string | undefined,
	stamp: Stamp,
): boolean {
	assertWritable(order);
	if (order.stage === "open") {
		throw new OrderError(
			`Order ${order.id} is not sealed. Seal it first: 'ttt order seal ${order.id} --gated-head <sha>'.`,
		);
	}
	const recorded = order.train.merged_commit;
	if (!mergedCommit && !recorded) {
		throw new OrderError("close needs --merged <sha> (the merge commit).");
	}
	if (mergedCommit) assertSha(mergedCommit, "--merged");
	if (mergedCommit && recorded && mergedCommit !== recorded) {
		throw new OrderError(
			`Order ${order.id} already records merge commit ${recorded}; rerun with --merged ${recorded} or without --merged.`,
		);
	}
	if (version && order.train.version && version !== order.train.version) {
		throw new OrderError(
			`Order ${order.id} already records version ${order.train.version}; rerun with --version ${order.train.version} or without --version.`,
		);
	}
	const firstMerge = order.stage !== "merged";
	const addsVersion = Boolean(version && !order.train.version);
	if (!firstMerge && !addsVersion) return false;

	if (mergedCommit) order.train.merged_commit = mergedCommit;
	if (version) order.train.version = version;
	order.stage = "merged";
	log(
		order,
		stamp,
		`merged at ${order.train.merged_commit}${order.train.version ? ` (${order.train.version})` : ""}`,
	);
	return true;
}

export function markTicketDone(
	order: WorkOrder,
	ticketId: string,
	remoteStatus: string,
	stamp: Stamp,
): void {
	const ticket = requireTicket(order, ticketId);
	if (ticket.state === "done") return;
	ticket.state = "done";
	log(order, stamp, `${ticketId} → ${remoteStatus}`);
}

/** Close the order once no ticket is left to complete. */
export function closeIfComplete(order: WorkOrder, stamp: Stamp): boolean {
	if (order.stage !== "merged") return order.stage === "closed";
	const open = order.tickets.some(
		(t) => t.state === "in-review" || t.state === "in-progress",
	);
	if (open) return false;
	order.stage = "closed";
	log(order, stamp, "closed");
	return true;
}

// ---------------------------------------------------------------------------
// Validation: order text comes from disk or from someone else's export
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string): string {
	// A bare number, such as an all-digit SHA or MR id typed by hand, decodes
	// as a number
	if (typeof value === "number") return String(value);
	if (typeof value !== "string" || !value) {
		throw new OrderError(`Invalid work order: "${field}" must be text.`);
	}
	return value;
}

function optionalText(value: unknown, field: string): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	return text(value, field);
}

function oneOf<T extends string>(
	value: unknown,
	allowed: readonly T[],
	field: string,
): T {
	if (!allowed.includes(value as T)) {
		throw new OrderError(
			`Invalid work order: "${field}" must be one of ${allowed.join(", ")}.`,
		);
	}
	return value as T;
}

function list(value: unknown, field: string): unknown[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) {
		throw new OrderError(`Invalid work order: "${field}" must be a list.`);
	}
	return value;
}

function compact<T extends object>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, v]) => v !== undefined),
	) as T;
}

/** Check decoded text against the order shape, dropping unknown fields. */
export function validateOrder(value: unknown): WorkOrder {
	if (!isRecord(value)) {
		throw new OrderError("Invalid work order: not a TOON object.");
	}
	const id = text(value.id, "id");
	parseOrderId(id);
	const train = isRecord(value.train) ? value.train : {};
	const handedOff = isRecord(value.handed_off) ? value.handed_off : undefined;
	const rev = typeof value.rev === "number" ? value.rev : 0;

	const tickets = list(value.tickets, "tickets").map((raw, index) => {
		if (!isRecord(raw)) {
			throw new OrderError(
				`Invalid work order: tickets[${index}] is malformed.`,
			);
		}
		const where = `tickets[${index}]`;
		return compact<OrderTicket>({
			id: text(raw.id, `${where}.id`),
			state: oneOf(raw.state, TICKET_STATES, `${where}.state`),
			branch: optionalText(raw.branch, `${where}.branch`),
			mr: optionalText(raw.mr, `${where}.mr`),
			head: optionalText(raw.head, `${where}.head`),
			review: optionalText(raw.review, `${where}.review`),
			reason: optionalText(raw.reason, `${where}.reason`),
			tests: list(raw.tests, `${where}.tests`).map((run, runIndex) => {
				const at = `${where}.tests[${runIndex}]`;
				if (!isRecord(run)) {
					throw new OrderError(`Invalid work order: ${at} is malformed.`);
				}
				return {
					command: text(run.command, `${at}.command`),
					sha: text(run.sha, `${at}.sha`),
					result: text(run.result, `${at}.result`),
					at: text(run.at, `${at}.at`),
				};
			}),
		});
	});

	const duplicate = tickets.find(
		(t, index) => tickets.findIndex((o) => o.id === t.id) !== index,
	);
	if (duplicate) {
		throw new OrderError(
			`Invalid work order: ticket ${duplicate.id} is listed twice.`,
		);
	}

	return compact<WorkOrder>({
		id,
		owner: text(value.owner, "owner"),
		reviewer: optionalText(value.reviewer, "reviewer"),
		stage: oneOf(value.stage, ORDER_STAGES, "stage"),
		rev,
		handed_off: handedOff
			? {
					at: text(handedOff.at, "handed_off.at"),
					by: text(handedOff.by, "handed_off.by"),
				}
			: undefined,
		train: compact({
			branch: optionalText(train.branch, "train.branch"),
			mr: optionalText(train.mr, "train.mr"),
			gated_head: optionalText(train.gated_head, "train.gated_head"),
			merged_commit: optionalText(train.merged_commit, "train.merged_commit"),
			version: optionalText(train.version, "train.version"),
		}),
		tickets,
		log: list(value.log, "log").map((raw, index): OrderLogEntry => {
			if (!isRecord(raw)) {
				throw new OrderError(`Invalid work order: log[${index}] is malformed.`);
			}
			return {
				at: text(raw.at, `log[${index}].at`),
				by: text(raw.by, `log[${index}].by`),
				event: text(raw.event, `log[${index}].event`),
			};
		}),
	});
}
