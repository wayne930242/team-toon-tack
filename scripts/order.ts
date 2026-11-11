#!/usr/bin/env bun
/**
 * ttt order - work orders: one file per train batch, from claim to Done
 */
import fs from "node:fs/promises";
import { getStatusTransitions } from "./lib/linear.js";
import { type CloseResult, closeTicket } from "./lib/order/close.js";
import {
	adoptImported,
	assertReviewable,
	assertSegment,
	assertWritable,
	closeIfComplete,
	dropTicket,
	findTicket,
	handOff,
	markInReview,
	markTicketDone,
	parseOrderId,
	reclaim,
	recordMerge,
	sealOrder,
	setTicket,
	setTrain,
} from "./lib/order/model.js";
import {
	connectRemote,
	moveToStatus,
	recordLocalStatuses,
	resolveReviewStatus,
	sourceNameOf,
	type TicketResult,
	writesRemote,
} from "./lib/order/remote.js";
import {
	assertFreeForOrder,
	defaultProject,
	listOrders,
	loadOrder,
	openOrder,
	saveImported,
	stampFor,
	updateOrder,
} from "./lib/order/store.js";
import { pickOrderBlock, renderOrderBlock } from "./lib/order/transfer.js";
import {
	OrderError,
	type OrderTicket,
	TICKET_STATES,
	type WorkOrder,
} from "./lib/order/types.js";
import { loadConfig, loadCycleData, loadLocalConfig } from "./utils.js";

const HELP = `Usage: ttt order <command> [options]

A work order is one file per train batch: .ttt/orders/<project>/<code>.toon.
It carries the batch's tickets from claim to Done. One side writes it at a
time: the coordinator who claims, then the integrator who merges.

Commands:
  open [<project>/<code>] [--project <p>] [--reviewer <name>]
        Open an order. Without an id: <project>/<YYYY-MM-DD>-<next letter>.
        A project holds one open order at a time.
  list [--project <p>] [--all]
        List orders (closed ones only with --all).
  show <id> [--toon]
        Show an order; --toon prints the stored TOON.
  set <id> <ticket> [--branch <b>] [--mr <mr>] [--head <sha>]
        [--review <verdict>] [--tests "<cmd> [@ <sha>] [= <result>]"]...
        Record a ticket's branch, MR, head, review verdict, and test runs.
        Each --tests appends one run; the sha defaults to the ticket's
        head, the result to "pass".
  review <id> <ticket>... [--status <name>]
        Move tickets to the testing status (assignee unchanged) and mark
        them in-review. An open order adopts a ticket it does not hold yet,
        unless another order of the project holds it. Done or Canceled
        tickets are left where they are.
  train <id> [--branch <b>] [--mr <mr>]
        Record the train branch and its merge request.
  seal <id> --gated-head <sha>
        Fix the batch: no more tickets. Every ticket must be in review or
        dropped. Sealing again records a new gated head.
  drop <id> <ticket> --reason <text>
        Leave a ticket out of the batch; its remote status is not touched.
  export <id> [--handoff]
        Print the order as a fenced block for an MR description or a slip.
        --handoff makes this copy read-only: the receiver writes from now on.
  import <file|-> [--id <id>] [--force]
        Read the block out of any text and become the order's writer.
  reclaim <id>
        Take a handed-off order back when it was returned without an export.
  close <id> --merged <sha> [--version <v>] [--dry-run]
        After the train merged: complete every in-review ticket through the
        configured completion mode, and comment MR, merge commit, version,
        and order id on each. Dropped tickets are untouched. Safe to rerun.

Claiming into an order:
  ttt claim MP-1 MP-2 --order auto [--project <p>]
        The project's open order, or a new one when the last was sealed.
  ttt claim MP-3 --order app/2026-11-11-a

Typical flow:
  coordinator   ttt claim MP-1 --order auto --project app
                ttt order set app/2026-11-11-a MP-1 --mr '!812' --head 1a2b3c4 \\
                    --review "P0/P1=0" --tests "bun test scripts/x = pass"
                ttt order review app/2026-11-11-a MP-1
                ttt order train app/2026-11-11-a --branch agent-train/2026-11-11-a --mr '!900'
                ttt order seal app/2026-11-11-a --gated-head 5d6e7f8
                ttt order export app/2026-11-11-a --handoff   # into the train MR
  integrator    glab mr view 900 | ttt order import -
                ttt order close app/2026-11-11-a --merged 9a8b7c6 --version v1.2.0

The default project is the directory that holds .ttt. The writer's name is
TTT_ACTOR, else <current_user>@<hostname>.`;

type FlagKind = "value" | "list" | "switch";

interface ParsedArgs {
	positional: string[];
	values: Record<string, string | undefined>;
	lists: Record<string, string[]>;
	switches: Set<string>;
}

/** Split args by `spec`; an unknown flag or a missing value is an error. */
function parseFlags(
	args: string[],
	spec: Record<string, FlagKind>,
): ParsedArgs {
	const parsed: ParsedArgs = {
		positional: [],
		values: {},
		lists: {},
		switches: new Set(),
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg.startsWith("--")) {
			parsed.positional.push(arg);
			continue;
		}
		const kind = spec[arg];
		if (!kind) {
			throw new OrderError(
				`Unknown option ${arg}. Run 'ttt order --help' for usage.`,
			);
		}
		if (kind === "switch") {
			parsed.switches.add(arg);
			continue;
		}
		const value = args[++i];
		if (value === undefined || value in spec) {
			throw new OrderError(`${arg} requires a value.`);
		}
		if (kind === "list") {
			parsed.lists[arg] = [...(parsed.lists[arg] ?? []), value];
		} else {
			parsed.values[arg] = value;
		}
	}
	return parsed;
}

function requireId(parsed: ParsedArgs, usage: string): string {
	const id = parsed.positional[0];
	if (!id) throw new OrderError(`Usage: ttt order ${usage}`);
	parseOrderId(id);
	return id;
}

function countByState(order: WorkOrder): string {
	const parts = TICKET_STATES.map((state) => {
		const count = order.tickets.filter((t) => t.state === state).length;
		return count > 0 ? `${count} ${state}` : "";
	}).filter(Boolean);
	return parts.length > 0 ? parts.join(", ") : "no tickets";
}

function describeTicket(ticket: OrderTicket): string[] {
	const head = [
		ticket.id.padEnd(10),
		ticket.state.padEnd(11),
		ticket.mr ?? "-",
		ticket.head ?? "-",
		ticket.branch ?? "",
	]
		.join("  ")
		.trimEnd();
	const lines = [`  ${head}`];
	if (ticket.review) lines.push(`      review: ${ticket.review}`);
	for (const run of ticket.tests) {
		lines.push(`      tests:  ${run.command} @ ${run.sha} = ${run.result}`);
	}
	if (ticket.reason) lines.push(`      reason: ${ticket.reason}`);
	return lines;
}

function printOrder(order: WorkOrder): void {
	const { train } = order;
	console.log(`Order ${order.id}  [${order.stage}]  rev ${order.rev}`);
	console.log(
		`Owner: ${order.owner}${order.reviewer ? `   Reviewer: ${order.reviewer}` : ""}`,
	);
	if (order.handed_off) {
		console.log(
			`Handed off: ${order.handed_off.at} by ${order.handed_off.by} (read-only here)`,
		);
	}
	console.log(
		`Train: branch ${train.branch ?? "-"} | MR ${train.mr ?? "-"} | gated ${train.gated_head ?? "-"} | merged ${train.merged_commit ?? "-"} | version ${train.version ?? "-"}`,
	);
	console.log(`Tickets (${order.tickets.length}): ${countByState(order)}`);
	for (const ticket of order.tickets) {
		for (const line of describeTicket(ticket)) console.log(line);
	}
	console.log("Log:");
	for (const entry of order.log) {
		console.log(`  ${entry.at}  ${entry.by}  ${entry.event}`);
	}
}

function printResults(results: TicketResult[]): void {
	for (const result of results) {
		console.log(`${result.ok ? "✅" : "❌"} ${result.id} ${result.detail}`);
	}
}

async function readText(source: string): Promise<string> {
	if (source !== "-") return fs.readFile(source, "utf8");
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks).toString("utf8");
}

async function cmdOpen(args: string[]): Promise<void> {
	const parsed = parseFlags(args, {
		"--project": "value",
		"--reviewer": "value",
	});
	const [id] = parsed.positional;
	let project = parsed.values["--project"];
	let code: string | undefined;
	if (id) {
		const parts = parseOrderId(id);
		if (project && project !== parts.project) {
			throw new OrderError(`--project ${project} does not match order ${id}.`);
		}
		({ project, code } = parts);
	}
	const order = await openOrder(
		{
			project: project ?? defaultProject(),
			code,
			reviewer: parsed.values["--reviewer"],
		},
		stampFor(await loadLocalConfig()),
	);
	console.log(`Opened order ${order.id} (owner ${order.owner})`);
}

async function cmdList(args: string[]): Promise<void> {
	const parsed = parseFlags(args, { "--project": "value", "--all": "switch" });
	const project = parsed.values["--project"];
	if (project) assertSegment(project, "project");
	const all = parsed.switches.has("--all");
	const orders = (await listOrders(project)).filter(
		(o) => all || o.stage !== "closed",
	);
	if (orders.length === 0) {
		console.log(
			all ? "No orders." : "No open orders ('--all' lists closed ones).",
		);
		return;
	}
	for (const order of orders) {
		console.log(
			`${order.id}  ${order.stage}${order.handed_off ? " (handed off)" : ""}  ${countByState(order)}  owner ${order.owner}`,
		);
	}
}

async function cmdShow(args: string[]): Promise<void> {
	const parsed = parseFlags(args, { "--toon": "switch" });
	const order = await loadOrder(requireId(parsed, "show <id> [--toon]"));
	if (parsed.switches.has("--toon")) {
		// The stored text without the fence
		console.log(renderOrderBlock(order).split("\n").slice(1, -1).join("\n"));
	} else {
		printOrder(order);
	}
}

async function cmdSet(args: string[]): Promise<void> {
	const parsed = parseFlags(args, {
		"--branch": "value",
		"--mr": "value",
		"--head": "value",
		"--review": "value",
		"--tests": "list",
	});
	const usage = "set <id> <ticket> [--branch --mr --head --review --tests]";
	const id = requireId(parsed, usage);
	const ticketId = parsed.positional[1];
	if (!ticketId || parsed.positional.length > 2) {
		throw new OrderError(`Usage: ttt order ${usage}`);
	}
	const stamp = stampFor(await loadLocalConfig());
	const order = await updateOrder(id, (o) => {
		setTicket(
			o,
			ticketId,
			{
				branch: parsed.values["--branch"],
				mr: parsed.values["--mr"],
				head: parsed.values["--head"],
				review: parsed.values["--review"],
				tests: parsed.lists["--tests"],
			},
			stamp,
		);
	});
	const ticket = order.tickets.find((t) => t.id === ticketId);
	console.log(`Order ${id}:`);
	if (ticket) for (const line of describeTicket(ticket)) console.log(line);
}

async function cmdReview(args: string[]): Promise<void> {
	const parsed = parseFlags(args, { "--status": "value" });
	const id = requireId(parsed, "review <id> <ticket>... [--status <name>]");
	const ticketIds = [...new Set(parsed.positional.slice(1))];
	if (ticketIds.length === 0) {
		throw new OrderError("Usage: ttt order review <id> <ticket>...");
	}
	const config = await loadConfig();
	const localConfig = await loadLocalConfig();
	const stamp = stampFor(localConfig);

	// Refuse before anything moves at the source
	const current = await loadOrder(id);
	assertReviewable(current, ticketIds);
	await assertFreeForOrder(
		id,
		ticketIds.filter((t) => !findTicket(current, t)),
	);

	const updates = new Map<string, string | null>();
	let results: TicketResult[];
	if (writesRemote(localConfig)) {
		const statusName = resolveReviewStatus(
			config,
			localConfig,
			parsed.values["--status"],
		);
		const remote = await connectRemote(config, localConfig);
		const data = await loadCycleData();
		results = await moveToStatus(
			ticketIds,
			statusName,
			remote,
			data?.tasks ?? [],
			getStatusTransitions(config).done,
		);
		for (const result of results) {
			if (result.ok) updates.set(result.id, statusName);
			console.log(
				result.ok
					? `${remote.sourceName}: ${result.id} ${result.detail}`
					: `⚠️ ${remote.sourceName}: ${result.id} 未更新 (${result.detail})`,
			);
		}
	} else {
		results = ticketIds.map((ticketId) => ({
			id: ticketId,
			ok: true,
			detail: "in-review (local)",
		}));
		for (const ticketId of ticketIds) updates.set(ticketId, null);
		console.log(
			`(${sourceNameOf(config)} status not updated - use 'sync --update' to push)`,
		);
	}

	const moved = results.filter((r) => r.ok).map((r) => r.id);
	if (moved.length > 0) {
		await updateOrder(id, (o) => markInReview(o, moved, stamp));
		await recordLocalStatuses(updates, "in-review", config, localConfig);
		console.log(`Order ${id}: ${moved.join(", ")} → in-review`);
	}
	if (moved.length < ticketIds.length) process.exitCode = 1;
}

async function cmdTrain(args: string[]): Promise<void> {
	const parsed = parseFlags(args, { "--branch": "value", "--mr": "value" });
	const id = requireId(parsed, "train <id> [--branch <b>] [--mr <mr>]");
	const stamp = stampFor(await loadLocalConfig());
	const order = await updateOrder(id, (o) => {
		setTrain(
			o,
			{ branch: parsed.values["--branch"], mr: parsed.values["--mr"] },
			stamp,
		);
	});
	console.log(
		`Order ${id}: train branch ${order.train.branch ?? "-"}, MR ${order.train.mr ?? "-"}`,
	);
}

async function cmdSeal(args: string[]): Promise<void> {
	const parsed = parseFlags(args, { "--gated-head": "value" });
	const id = requireId(parsed, "seal <id> --gated-head <sha>");
	const gatedHead = parsed.values["--gated-head"];
	if (!gatedHead) throw new OrderError("seal needs --gated-head <sha>.");
	const stamp = stampFor(await loadLocalConfig());
	const order = await updateOrder(id, (o) => sealOrder(o, gatedHead, stamp));
	console.log(
		`Order ${id} sealed at ${gatedHead}: ${countByState(order)}. Next: ttt order export ${id} --handoff`,
	);
}

async function cmdDrop(args: string[]): Promise<void> {
	const parsed = parseFlags(args, { "--reason": "value" });
	const id = requireId(parsed, "drop <id> <ticket> --reason <text>");
	const ticketId = parsed.positional[1];
	if (!ticketId || parsed.positional.length > 2) {
		throw new OrderError("Usage: ttt order drop <id> <ticket> --reason <text>");
	}
	const stamp = stampFor(await loadLocalConfig());
	await updateOrder(id, (o) =>
		dropTicket(o, ticketId, parsed.values["--reason"] ?? "", stamp),
	);
	console.log(
		`Order ${id}: dropped ${ticketId} (its status at the source is unchanged)`,
	);
}

async function cmdExport(args: string[]): Promise<void> {
	const parsed = parseFlags(args, { "--handoff": "switch" });
	const id = requireId(parsed, "export <id> [--handoff]");
	let order: WorkOrder;
	if (parsed.switches.has("--handoff")) {
		const stamp = stampFor(await loadLocalConfig());
		order = await updateOrder(id, (o) => handOff(o, stamp));
		// The block is the only thing on stdout, so it can be piped or pasted
		console.error(
			`Order ${id} handed off: this copy is now read-only. The receiver runs 'ttt order import <file|->'.`,
		);
	} else {
		order = await loadOrder(id);
	}
	console.log(renderOrderBlock(order));
}

async function cmdImport(args: string[]): Promise<void> {
	const parsed = parseFlags(args, { "--id": "value", "--force": "switch" });
	const [source] = parsed.positional;
	if (!source) {
		throw new OrderError(
			"Usage: ttt order import <file|-> [--id <id>] [--force]",
		);
	}
	const incoming = pickOrderBlock(
		await readText(source),
		parsed.values["--id"],
	);
	const stamp = stampFor(await loadLocalConfig());
	if (!incoming.handed_off) {
		console.error(
			`⚠️ This export of ${incoming.id} was not handed off: ${incoming.owner} can still write to their copy.`,
		);
	}
	const order = await saveImported(incoming.id, (local) =>
		adoptImported(incoming, local, stamp, parsed.switches.has("--force")),
	);
	console.log(
		`Imported order ${order.id} [${order.stage}]: ${countByState(order)}. You (${order.owner}) are now its writer.`,
	);
	console.log(
		`Tickets: ${order.tickets.map((t) => `${t.id} (${t.state})`).join(", ") || "none"}`,
	);
}

async function cmdReclaim(args: string[]): Promise<void> {
	const parsed = parseFlags(args, {});
	const id = requireId(parsed, "reclaim <id>");
	const stamp = stampFor(await loadLocalConfig());
	const order = await updateOrder(id, (o) => reclaim(o, stamp));
	console.log(
		`Order ${id} reclaimed [${order.stage}]: this copy is writable again. Changes made on the other side are not in it; import their export to get them.`,
	);
}

function printCloseSummary(order: WorkOrder): void {
	console.log(
		`Order ${order.id} [${order.stage}]: ${countByState(order)} | merged ${order.train.merged_commit ?? "-"}${order.train.version ? ` | ${order.train.version}` : ""}`,
	);
}

async function cmdClose(args: string[]): Promise<void> {
	const parsed = parseFlags(args, {
		"--merged": "value",
		"--version": "value",
		"--dry-run": "switch",
	});
	const id = requireId(
		parsed,
		"close <id> --merged <sha> [--version <v>] [--dry-run]",
	);
	const dryRun = parsed.switches.has("--dry-run");
	const config = await loadConfig();
	const localConfig = await loadLocalConfig();
	const stamp = stampFor(localConfig);

	let order = await loadOrder(id);
	if (order.stage === "closed") {
		console.log(`Order ${id} is already closed; nothing to do.`);
		printCloseSummary(order);
		return;
	}

	// Validate on a copy first, so a dry run or a refusal writes nothing
	const preview = structuredClone(order);
	recordMerge(
		preview,
		parsed.values["--merged"],
		parsed.values["--version"],
		stamp,
	);
	if (!dryRun) {
		order = await updateOrder(id, (o) =>
			recordMerge(
				o,
				parsed.values["--merged"],
				parsed.values["--version"],
				stamp,
			),
		);
	} else {
		order = preview;
	}

	const results: CloseResult[] = [];
	const remoteMode = writesRemote(localConfig);
	const remote =
		remoteMode && order.tickets.some((t) => t.state === "in-review")
			? await connectRemote(config, localConfig)
			: null;
	const updates = new Map<string, string | null>();

	for (const ticket of order.tickets) {
		if (ticket.state === "dropped" || ticket.state === "done") continue;
		if (ticket.state === "in-progress") {
			results.push({
				id: ticket.id,
				ok: false,
				detail: `is still in-progress in the order; send it to review or drop it`,
			});
			continue;
		}

		let result: CloseResult;
		if (remote) {
			result = await closeTicket(order, ticket, {
				config,
				localConfig,
				remote,
				dryRun,
			});
		} else {
			result = {
				id: ticket.id,
				ok: true,
				detail: dryRun ? "would mark it done (local)" : "done (local)",
			};
		}
		results.push(result);

		if (result.ok && !dryRun) {
			// Persist ticket by ticket: a crash keeps what is already done
			const status = result.status ?? "completed";
			await updateOrder(id, (o) => {
				assertWritable(o);
				markTicketDone(o, ticket.id, status, stamp);
			});
			updates.set(ticket.id, result.status ?? null);
		}
	}

	printResults(results);

	if (dryRun) {
		console.log("(dry-run: no changes made)");
		return;
	}

	await recordLocalStatuses(updates, "completed", config, localConfig);
	order = await updateOrder(id, (o) => closeIfComplete(o, stamp));
	if (!remoteMode) {
		console.log(
			`(${sourceNameOf(config)} status not updated - use 'sync --update' to push)`,
		);
	}
	printCloseSummary(order);
	if (order.stage !== "closed") {
		console.error(
			`Order ${id} is not closed yet. Fix the failed tickets and rerun 'ttt order close ${id}'.`,
		);
		process.exitCode = 1;
	}
}

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
	open: cmdOpen,
	list: cmdList,
	show: cmdShow,
	set: cmdSet,
	review: cmdReview,
	train: cmdTrain,
	seal: cmdSeal,
	drop: cmdDrop,
	export: cmdExport,
	import: cmdImport,
	reclaim: cmdReclaim,
	close: cmdClose,
};

async function order() {
	const [command, ...args] = process.argv.slice(2);

	if (
		!command ||
		command === "--help" ||
		command === "-h" ||
		command === "help"
	) {
		console.log(HELP);
		return;
	}
	if (args.includes("--help") || args.includes("-h")) {
		console.log(HELP);
		return;
	}

	const run = COMMANDS[command];
	if (!run) {
		throw new OrderError(
			`Unknown order command: ${command}. Run 'ttt order --help' for usage.`,
		);
	}
	await run(args);
}

order().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
