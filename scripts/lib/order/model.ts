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
	type OrderTicketNote,
	type ReturnNotice,
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

/** A dropped or returned ticket has left the batch: another order may take it. */
export function hasLeft(ticket: OrderTicket): boolean {
	return ticket.state === "dropped" || ticket.state === "returned";
}

/** True when both name one commit, however far each is abbreviated. */
function sameCommit(a: string, b: string): boolean {
	const [x, y] = [a.toLowerCase(), b.toLowerCase()];
	return x.startsWith(y) || y.startsWith(x);
}

/**
 * A review is stale when the ticket's head moved after the verdict was
 * recorded. Returns the two heads, or undefined when the review stands (or
 * the order predates `review_head`).
 */
export function reviewStaleness(
	ticket: OrderTicket,
): { reviewed: string; head: string } | undefined {
	if (!ticket.review || !ticket.review_head || !ticket.head) return undefined;
	if (sameCommit(ticket.review_head, ticket.head)) return undefined;
	return { reviewed: ticket.review_head, head: ticket.head };
}

/**
 * Put tickets in the order as in-progress. A ticket already there is left as
 * it is; a dropped or returned one comes back. Returns the IDs that changed.
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
		if (existing && !hasLeft(existing)) continue;
		if (existing) {
			existing.state = "in-progress";
			delete existing.reason;
			delete existing.returned;
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
	if (hasLeft(ticket)) {
		throw new OrderError(
			`${ticketId} was ${ticket.state} from order ${order.id}. Bring it back with 'ttt claim ${ticketId} --order ${order.id}' first, or take it into another order with 'ttt order carry ${ticketId} --to <id|auto> --from ${order.id}'.`,
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
	if (fields.review !== undefined) {
		// The verdict is for the head recorded with it, else the current one
		if (ticket.head) ticket.review_head = ticket.head;
		else delete ticket.review_head;
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
	const stale = fields.head !== undefined ? reviewStaleness(ticket) : undefined;
	log(
		order,
		stamp,
		`set ${ticketId}: ${changed.join(", ")}${stale ? ` (review stale: reviewed ${stale.reviewed}, head now ${stale.head})` : ""}`,
	);
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
		} else if (hasLeft(ticket) || ticket.state === "done") {
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

function requireHeld(order: WorkOrder, ticketId: string): OrderTicket {
	const ticket = findTicket(order, ticketId);
	if (!ticket) {
		throw new OrderError(`${ticketId} is not in order ${order.id}.`);
	}
	return ticket;
}

/** Tickets that `return` may hand back: every one in the order, none done. */
export function assertReturnable(order: WorkOrder, ticketIds: string[]): void {
	assertWritable(order);
	for (const id of ticketIds) {
		const ticket = requireHeld(order, id);
		if (ticket.state === "done") {
			throw new OrderError(
				`${id} is already done in order ${order.id}; it cannot be returned.`,
			);
		}
		if (ticket.state === "dropped") {
			throw new OrderError(
				`${id} was dropped from order ${order.id}${ticket.reason ? ` (${ticket.reason})` : ""}; return it from the order that holds it now.`,
			);
		}
	}
}

/**
 * Hand tickets back to their coordinator. Each keeps its record and gains a
 * `returned` note; one already returned is left as it is. Returns the IDs
 * that changed.
 */
export function returnTickets(
	order: WorkOrder,
	ticketIds: string[],
	reason: string,
	stamp: Stamp,
): string[] {
	assertReturnable(order, ticketIds);
	if (!reason.trim()) {
		throw new OrderError("return needs --reason <text>.");
	}
	const returned: string[] = [];
	for (const id of ticketIds) {
		const ticket = requireHeld(order, id);
		if (ticket.state === "returned") continue;
		ticket.state = "returned";
		ticket.returned = { at: stamp.at, by: stamp.by, reason };
		delete ticket.reason;
		returned.push(id);
	}
	if (returned.length > 0) {
		log(order, stamp, `returned ${returned.join(", ")}: ${reason}`);
	}
	return returned;
}

/** The ticket `rework` may send back to work, in an order not merged yet. */
export function assertReworkable(
	order: WorkOrder,
	ticketId: string,
): OrderTicket {
	assertWritable(order);
	if (order.stage === "merged") {
		throw new OrderError(
			`Order ${order.id} is already merged (${order.train.merged_commit}). A ticket that is not in the merge leaves with 'ttt order return ${order.id} ${ticketId} --reason ...'.`,
		);
	}
	const ticket = requireHeld(order, ticketId);
	if (ticket.state !== "in-review" && ticket.state !== "in-progress") {
		throw new OrderError(
			`${ticketId} is ${ticket.state} in order ${order.id}; only a ticket in review can be reworked.`,
		);
	}
	return ticket;
}

/**
 * Send an in-review ticket back to work inside its order. A sealed order
 * opens again and loses its gated head: the batch must be gated and sealed
 * anew. Returns false when the ticket was already in progress.
 */
export function reworkTicket(
	order: WorkOrder,
	ticketId: string,
	reason: string,
	stamp: Stamp,
): boolean {
	const ticket = assertReworkable(order, ticketId);
	if (!reason.trim()) {
		throw new OrderError("rework needs --reason <text>.");
	}
	if (ticket.state === "in-progress") return false;
	ticket.state = "in-progress";
	ticket.reworked = { at: stamp.at, by: stamp.by, reason };
	let reopened = "";
	if (order.stage === "sealed") {
		const gated = order.train.gated_head;
		order.stage = "open";
		delete order.train.gated_head;
		reopened = ` (order reopened${gated ? `, gated head ${gated} cleared` : ""})`;
	}
	log(order, stamp, `rework ${ticketId}: ${reason}${reopened}`);
	return true;
}

const runKey = (run: OrderTestRun) =>
	[run.command, run.sha, run.result, run.at].join("\u0000");

/**
 * Take tickets into `dest` with the history they had in `sourceId`: branch,
 * MR, head, review (bound to the head it was given on), and test runs. They
 * arrive in progress. A ticket `dest` already holds without history gets the
 * missing fields filled in; one already carried from `sourceId` is left as
 * it is. Returns the IDs that changed.
 */
export function adoptCarried(
	dest: WorkOrder,
	sourceId: string,
	sources: OrderTicket[],
	stamp: Stamp,
): string[] {
	assertAcceptsTickets(dest);
	if (sourceId === dest.id) {
		throw new OrderError(
			`Order ${dest.id} cannot carry tickets from itself; name another order with --to.`,
		);
	}
	const carried: string[] = [];
	for (const source of sources) {
		const history = {
			branch: source.branch,
			mr: source.mr,
			head: source.head,
			review: source.review,
			review_head: source.review
				? (source.review_head ?? source.head)
				: undefined,
		};
		const tests = source.tests.map((run) => ({ ...run }));
		const carriedFrom = { order: sourceId, at: stamp.at, by: stamp.by };
		const fresh = (): OrderTicket =>
			compact<OrderTicket>({
				id: source.id,
				state: "in-progress",
				...history,
				carried_from: carriedFrom,
				tests,
			});

		const index = dest.tickets.findIndex((t) => t.id === source.id);
		const existing = dest.tickets[index];
		if (!existing) {
			dest.tickets.push(fresh());
		} else if (existing.state === "done") {
			throw new OrderError(
				`${source.id} is already done in order ${dest.id}; it cannot be carried there.`,
			);
		} else if (hasLeft(existing)) {
			// Back in this order, with the history of where it has been since;
			// what the source lacks comes from this order's own earlier record
			const back = fresh();
			back.branch ??= existing.branch;
			back.mr ??= existing.mr;
			back.head ??= existing.head;
			if (back.review === undefined && existing.review !== undefined) {
				back.review = existing.review;
				if (existing.review_head) back.review_head = existing.review_head;
			}
			const known = new Set(back.tests.map(runKey));
			back.tests = [
				...back.tests,
				...existing.tests.filter((run) => !known.has(runKey(run))),
			];
			dest.tickets[index] = back;
		} else if (existing.carried_from?.order === sourceId) {
			continue;
		} else {
			// Claimed here without its history: fill in what is missing
			existing.branch ??= history.branch;
			existing.mr ??= history.mr;
			existing.head ??= history.head;
			if (existing.review === undefined && history.review !== undefined) {
				existing.review = history.review;
				if (history.review_head) existing.review_head = history.review_head;
			}
			const known = new Set(existing.tests.map(runKey));
			existing.tests = [
				...tests.filter((run) => !known.has(runKey(run))),
				...existing.tests,
			];
			existing.carried_from = carriedFrom;
		}
		carried.push(source.id);
	}
	if (carried.length > 0) {
		log(dest, stamp, `carried ${carried.join(", ")} from ${sourceId}`);
	}
	return carried;
}

/**
 * In the source order, mark tickets that were carried to `destId` as dropped.
 * Returns the IDs that changed.
 */
export function markCarriedAway(
	source: WorkOrder,
	ticketIds: string[],
	destId: string,
	stamp: Stamp,
): string[] {
	assertWritable(source);
	const reason = `carried to ${destId}`;
	const changed: string[] = [];
	for (const id of ticketIds) {
		const ticket = findTicket(source, id);
		if (!ticket || ticket.state === "done") continue;
		if (ticket.state === "dropped" && ticket.reason === reason) continue;
		ticket.state = "dropped";
		ticket.reason = reason;
		changed.push(id);
	}
	if (changed.length > 0) {
		log(source, stamp, `dropped ${changed.join(", ")}: ${reason}`);
	}
	return changed;
}

/** What the order's writer tells the coordinator about `ticketIds`. */
export function buildReturnNotice(
	order: WorkOrder,
	ticketIds: string[],
	stamp: Stamp,
): ReturnNotice {
	return {
		order: order.id,
		rev: order.rev,
		by: stamp.by,
		at: stamp.at,
		tickets: order.tickets.filter(
			(t) => ticketIds.includes(t.id) && t.state === "returned",
		),
	};
}

const sameNote = (a?: OrderTicketNote, b?: OrderTicketNote) =>
	a?.at === b?.at && a?.by === b?.by && a?.reason === b?.reason;

/**
 * Record a return notice on this copy of the order: each returned ticket
 * takes the writer's record of it. A handed-off copy takes it too, because a
 * notice reports what the writer did and changes nothing about who writes.
 * Returns the IDs that changed.
 */
export function applyReturnNotice(
	order: WorkOrder,
	notice: ReturnNotice,
	stamp: Stamp,
): string[] {
	if (notice.order !== order.id) {
		throw new OrderError(
			`The return notice is for order ${notice.order}, not ${order.id}.`,
		);
	}
	const changed: string[] = [];
	for (const incoming of notice.tickets) {
		const index = order.tickets.findIndex((t) => t.id === incoming.id);
		const local = order.tickets[index];
		if (local?.state === "done") {
			throw new OrderError(
				`${incoming.id} is done in this copy of ${order.id}; the return notice does not apply to it.`,
			);
		}
		// Already recorded here, and possibly carried on since
		if (local?.returned && sameNote(local.returned, incoming.returned)) {
			continue;
		}
		const record = structuredClone(incoming);
		if (local) order.tickets[index] = record;
		else order.tickets.push(record);
		changed.push(incoming.id);
	}
	if (changed.length > 0) {
		log(order, stamp, `return notice from ${notice.by}: ${changed.join(", ")}`);
	}
	return changed;
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

function optionalNote(
	value: unknown,
	field: string,
): OrderTicketNote | undefined {
	if (!isRecord(value)) return undefined;
	return {
		at: text(value.at, `${field}.at`),
		by: text(value.by, `${field}.by`),
		reason: text(value.reason, `${field}.reason`),
	};
}

/** Fields added after 3.13 are optional, so older files and blocks load. */
function validateTicket(raw: unknown, where: string): OrderTicket {
	if (!isRecord(raw)) {
		throw new OrderError(`Invalid work order: ${where} is malformed.`);
	}
	const carriedFrom = isRecord(raw.carried_from) ? raw.carried_from : undefined;
	return compact<OrderTicket>({
		id: text(raw.id, `${where}.id`),
		state: oneOf(raw.state, TICKET_STATES, `${where}.state`),
		branch: optionalText(raw.branch, `${where}.branch`),
		mr: optionalText(raw.mr, `${where}.mr`),
		head: optionalText(raw.head, `${where}.head`),
		review: optionalText(raw.review, `${where}.review`),
		review_head: optionalText(raw.review_head, `${where}.review_head`),
		reason: optionalText(raw.reason, `${where}.reason`),
		returned: optionalNote(raw.returned, `${where}.returned`),
		reworked: optionalNote(raw.reworked, `${where}.reworked`),
		carried_from: carriedFrom
			? {
					order: text(carriedFrom.order, `${where}.carried_from.order`),
					at: text(carriedFrom.at, `${where}.carried_from.at`),
					by: text(carriedFrom.by, `${where}.carried_from.by`),
				}
			: undefined,
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
}

function validateTickets(value: unknown): OrderTicket[] {
	const tickets = list(value, "tickets").map((raw, index) =>
		validateTicket(raw, `tickets[${index}]`),
	);
	const duplicate = tickets.find(
		(t, index) => tickets.findIndex((o) => o.id === t.id) !== index,
	);
	if (duplicate) {
		throw new OrderError(
			`Invalid work order: ticket ${duplicate.id} is listed twice.`,
		);
	}
	return tickets;
}

/** Check a decoded return notice, dropping unknown fields. */
export function validateReturnNotice(value: unknown): ReturnNotice {
	if (!isRecord(value)) {
		throw new OrderError("Invalid return notice: not a TOON object.");
	}
	const order = text(value.order, "order");
	parseOrderId(order);
	const tickets = validateTickets(value.tickets);
	const active = tickets.find((t) => t.state !== "returned");
	if (active) {
		throw new OrderError(
			`Invalid return notice: ${active.id} is ${active.state}, not returned.`,
		);
	}
	return {
		order,
		rev: typeof value.rev === "number" ? value.rev : 0,
		by: text(value.by, "by"),
		at: text(value.at, "at"),
		tickets,
	};
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

	const tickets = validateTickets(value.tickets);

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
