import { test } from "bun:test";
import assert from "node:assert/strict";
import {
	addTickets,
	adoptCarried,
	adoptImported,
	applyReturnNotice,
	buildReturnNotice,
	closeIfComplete,
	dropTicket,
	handOff,
	markCarriedAway,
	markInReview,
	markTicketDone,
	newOrder,
	nextCode,
	parseOrderId,
	parseTestRun,
	reclaim,
	recordMerge,
	returnTickets,
	reviewStaleness,
	reworkTicket,
	sealOrder,
	setTicket,
	setTrain,
	validateOrder,
} from "./model.js";
import { OrderError, type WorkOrder } from "./types.js";

const box = { by: "coord@box", at: "2026-11-11T01:00:00.000Z" };
const mac = { by: "integ@mac", at: "2026-11-11T05:00:00.000Z" };

/** An order with MP-1 and MP-2 in review, sealed at `gated`. */
function sealedOrder(): WorkOrder {
	const order = newOrder("app/2026-11-11-a", box);
	addTickets(order, ["MP-1", "MP-2"], box);
	markInReview(order, ["MP-1", "MP-2"], box);
	sealOrder(order, "5d6e7f8", box);
	return order;
}

test("nextCode walks a, b, ... z, aa for the given date only", () => {
	assert.equal(nextCode([], "2026-11-11"), "2026-11-11-a");
	assert.equal(
		nextCode(["2026-11-10-a", "2026-11-11-a", "2026-11-11-b"], "2026-11-11"),
		"2026-11-11-c",
	);
	const letters = [..."abcdefghijklmnopqrstuvwxyz"].map(
		(l) => `2026-11-11-${l}`,
	);
	assert.equal(nextCode(letters, "2026-11-11"), "2026-11-11-aa");
});

test("an order id is <project>/<code> and cannot leave the orders directory", () => {
	assert.deepEqual(parseOrderId("app/2026-11-11-a"), {
		project: "app",
		code: "2026-11-11-a",
	});
	for (const bad of ["app", "a/b/c", "../x", "app/..", "app/.hidden", "/x"]) {
		assert.throws(() => parseOrderId(bad), OrderError, bad);
	}
});

test("parseTestRun reads command, sha and result, with defaults from the ticket", () => {
	assert.deepEqual(
		parseTestRun(
			"bun test scripts/x --filter=a @ 1a2b3c4 = 12 pass",
			"ffffff0",
			"t",
		),
		{
			command: "bun test scripts/x --filter=a",
			sha: "1a2b3c4",
			result: "12 pass",
			at: "t",
		},
	);
	assert.deepEqual(parseTestRun("npm run lint", "ffffff0", "t"), {
		command: "npm run lint",
		sha: "ffffff0",
		result: "pass",
		at: "t",
	});
	assert.throws(
		() => parseTestRun("npm run lint", undefined, "t"),
		/names no commit/,
	);
	assert.throws(
		() => parseTestRun("x @ not-a-sha", undefined, "t"),
		/commit SHA/,
	);
});

test("setTicket records fields and appends test runs; a bad run changes nothing", () => {
	const order = newOrder("app/2026-11-11-a", box);
	addTickets(order, ["MP-1"], box);

	setTicket(
		order,
		"MP-1",
		{ mr: "!812", head: "1a2b3c4", tests: ["bun test = pass"] },
		box,
	);
	setTicket(order, "MP-1", { tests: ["npm run lint @ 2b3c4d5 = fail"] }, box);

	const [ticket] = order.tickets;
	assert.equal(ticket.mr, "!812");
	assert.deepEqual(
		ticket.tests.map((r) => `${r.command}@${r.sha}=${r.result}`),
		["bun test@1a2b3c4=pass", "npm run lint@2b3c4d5=fail"],
	);

	assert.throws(
		() => setTicket(order, "MP-1", { branch: "x", tests: ["t @ zzz"] }, box),
		OrderError,
	);
	assert.equal(
		ticket.branch,
		undefined,
		"a refused set leaves the ticket as it was",
	);
	assert.throws(
		() => setTicket(order, "MP-9", { mr: "!1" }, box),
		/ttt claim MP-9 --order/,
	);
	assert.throws(() => setTicket(order, "MP-1", {}, box), /Nothing to record/);
});

test("seal needs every ticket in review or dropped, then takes no more tickets", () => {
	const order = newOrder("app/2026-11-11-a", box);
	addTickets(order, ["MP-1", "MP-2"], box);
	markInReview(order, ["MP-1"], box);

	assert.throws(
		() => sealOrder(order, "5d6e7f8", box),
		/MP-2 still in progress.*ttt order review.*ttt order drop/,
	);
	dropTicket(order, "MP-2", "not ready", box);
	sealOrder(order, "5d6e7f8", box);

	assert.equal(order.stage, "sealed");
	assert.equal(order.train.gated_head, "5d6e7f8");
	assert.throws(
		() => addTickets(order, ["MP-3"], box),
		/takes no more tickets.*--order auto/,
	);
	assert.throws(
		() => markInReview(order, ["MP-3"], box),
		/takes no more tickets/,
	);

	// A reworked ticket stays in its order: new head, new gate
	setTicket(order, "MP-1", { head: "2b3c4d5" }, box);
	sealOrder(order, "6e7f8a9", box);
	assert.equal(order.train.gated_head, "6e7f8a9");
});

test("a dropped ticket comes back when it is claimed into the open order again", () => {
	const order = newOrder("app/2026-11-11-a", box);
	addTickets(order, ["MP-1"], box);
	dropTicket(order, "MP-1", "blocked", box);

	assert.deepEqual(addTickets(order, ["MP-1"], box), ["MP-1"]);
	assert.equal(order.tickets[0].state, "in-progress");
	assert.equal(order.tickets[0].reason, undefined);
	assert.deepEqual(addTickets(order, ["MP-1"], box), [], "already there");
});

test("a handed-off copy refuses every write and says how to get it back", () => {
	const order = sealedOrder();
	handOff(order, box);

	const writes: (() => void)[] = [
		() => setTicket(order, "MP-1", { mr: "!1" }, box),
		() => markInReview(order, ["MP-1"], box),
		() => setTrain(order, { mr: "!900" }, box),
		() => sealOrder(order, "5d6e7f8", box),
		() => dropTicket(order, "MP-1", "x", box),
		() => handOff(order, box),
		() => recordMerge(order, "9a8b7c6", undefined, box),
	];
	for (const write of writes) {
		assert.throws(
			write,
			/read-only.*ttt order import.*ttt order reclaim app\/2026-11-11-a/,
		);
	}

	reclaim(order, box);
	assert.equal(order.handed_off, undefined);
	setTrain(order, { mr: "!900" }, box);
	assert.throws(() => reclaim(order, box), /not handed off/);
});

test("the importer becomes the writer; a writable or newer local copy is kept", () => {
	const exported = sealedOrder();
	handOff(exported, box);
	exported.rev = 7;

	const imported = adoptImported(exported, undefined, mac, false);
	assert.equal(imported.owner, "integ@mac");
	assert.equal(imported.handed_off, undefined);
	assert.equal(imported.log.at(-1)?.event, "imported from coord@box");

	const writableLocal = { ...sealedOrder(), rev: 3 };
	assert.throws(
		() => adoptImported(exported, writableLocal, mac, false),
		/writable copy.*--force/,
	);
	adoptImported(exported, writableLocal, mac, true);

	const newerLocal = { ...sealedOrder(), rev: 9 };
	handOff(newerLocal, box);
	assert.throws(
		() => adoptImported(exported, newerLocal, mac, false),
		/rev 7\) is older than the local one \(rev 9\)/,
	);
});

test("merge is recorded once: a rerun is a no-op, another commit is refused", () => {
	const open = newOrder("app/2026-11-11-a", box);
	assert.throws(
		() => recordMerge(open, "9a8b7c6", undefined, mac),
		/not sealed.*ttt order seal/,
	);

	const order = sealedOrder();
	assert.throws(
		() => recordMerge(order, undefined, undefined, mac),
		/--merged <sha>/,
	);
	assert.throws(() => recordMerge(order, "nope", undefined, mac), /commit SHA/);

	assert.equal(recordMerge(order, "9a8b7c6", "v1.2.0", mac), true);
	assert.equal(order.stage, "merged");
	assert.equal(recordMerge(order, "9a8b7c6", "v1.2.0", mac), false);
	assert.equal(recordMerge(order, undefined, undefined, mac), false);
	assert.throws(
		() => recordMerge(order, "0000000", undefined, mac),
		/already records merge commit 9a8b7c6/,
	);
	assert.throws(
		() => recordMerge(order, undefined, "v9", mac),
		/already records version v1.2.0/,
	);
});

test("the order closes when its last in-review ticket is done; dropped ones do not hold it", () => {
	const order = sealedOrder();
	dropTicket(order, "MP-2", "returned", box);
	recordMerge(order, "9a8b7c6", undefined, mac);

	assert.equal(closeIfComplete(order, mac), false);
	markTicketDone(order, "MP-1", "Done", mac);
	assert.equal(closeIfComplete(order, mac), true);
	assert.equal(order.stage, "closed");
	assert.deepEqual(
		order.tickets.map((t) => t.state),
		["done", "dropped"],
	);
	assert.throws(
		() => setTicket(order, "MP-1", { mr: "!1" }, mac),
		/is closed.*ttt order open/,
	);
});

test("validateOrder rejects text that is not a work order", () => {
	const good = JSON.parse(JSON.stringify(sealedOrder()));
	assert.deepEqual(validateOrder(good), sealedOrder());

	const first = good.tickets[0];
	const broken: [string, Record<string, unknown>][] = [
		["id", { ...good, id: "../../etc/passwd" }],
		["stage", { ...good, stage: "shipped" }],
		["owner", { ...good, owner: undefined }],
		["tickets", { ...good, tickets: "MP-1" }],
		["state", { ...good, tickets: [{ ...first, state: "merged" }] }],
		["listed twice", { ...good, tickets: [first, first] }],
	];
	for (const [what, value] of broken) {
		assert.throws(() => validateOrder(value), OrderError, what);
	}
	assert.throws(() => validateOrder("just text"), OrderError);
});

test("a returned ticket keeps its record, never blocks seal or close, and returns only once", () => {
	const order = newOrder("app/2026-11-11-a", box);
	addTickets(order, ["MP-1", "MP-2"], box);
	setTicket(order, "MP-2", { mr: "!813", head: "1a2b3c4" }, box);
	markInReview(order, ["MP-1", "MP-2"], box);
	sealOrder(order, "5d6e7f8", box);

	assert.deepEqual(returnTickets(order, ["MP-2"], "pair not ready", mac), [
		"MP-2",
	]);
	const later = { by: "integ@mac", at: "2026-11-11T06:00:00.000Z" };
	assert.deepEqual(returnTickets(order, ["MP-2"], "again", later), []);
	const returned = order.tickets[1];
	assert.equal(returned.state, "returned");
	assert.deepEqual(returned.returned, { ...mac, reason: "pair not ready" });
	assert.equal(returned.mr, "!813");
	assert.throws(() => returnTickets(order, ["MP-9"], "x", mac), /not in order/);
	assert.throws(() => returnTickets(order, ["MP-1"], " ", mac), /--reason/);
	assert.throws(
		() => setTicket(order, "MP-2", { mr: "!1" }, mac),
		/was returned.*ttt order carry/,
	);
	assert.throws(
		() => markInReview(order, ["MP-2"], mac),
		/returned.*cannot go to review/,
	);

	// Sealing again accepts it like a dropped ticket
	sealOrder(order, "6e7f8a9", mac);
	recordMerge(order, "9a8b7c6", undefined, mac);
	markTicketDone(order, "MP-1", "Done", mac);
	assert.equal(closeIfComplete(order, mac), true);
	assert.equal(returned.state, "returned");
	assert.throws(
		() => returnTickets(sealedDone(), ["MP-1"], "x", mac),
		/already done/,
	);
});

function sealedDone(): WorkOrder {
	const order = sealedOrder();
	recordMerge(order, "9a8b7c6", undefined, mac);
	markTicketDone(order, "MP-1", "Done", mac);
	return order;
}

test("rework reopens a sealed order and clears its gated head; a merged order refuses", () => {
	const order = sealedOrder();

	assert.equal(reworkTicket(order, "MP-1", "gate red", mac), true);
	assert.equal(order.stage, "open");
	assert.equal(order.train.gated_head, undefined);
	assert.equal(order.tickets[0].state, "in-progress");
	assert.deepEqual(order.tickets[0].reworked, { ...mac, reason: "gate red" });
	assert.match(order.log.at(-1)?.event ?? "", /gated head 5d6e7f8 cleared/);
	// Asking again changes nothing
	assert.equal(reworkTicket(order, "MP-1", "gate red", mac), false);
	assert.throws(() => sealOrder(order, "6e7f8a9", mac), /still in progress/);

	// In an open order only the ticket moves
	assert.equal(reworkTicket(order, "MP-2", "review fix", mac), true);
	assert.equal(order.stage, "open");

	const merged = sealedOrder();
	recordMerge(merged, "9a8b7c6", undefined, mac);
	assert.throws(
		() => reworkTicket(merged, "MP-1", "late", mac),
		/already merged.*ttt order return/,
	);
	const dropped = sealedOrder();
	dropTicket(dropped, "MP-2", "x", mac);
	assert.throws(
		() => reworkTicket(dropped, "MP-2", "x", mac),
		/only a ticket in review/,
	);
});

test("a review is stale once the head it was recorded on moves, however the SHAs are abbreviated", () => {
	const order = newOrder("app/2026-11-11-a", box);
	addTickets(order, ["MP-1"], box);
	const ticket = setTicket(
		order,
		"MP-1",
		{ head: "1a2b3c4d5e6f", review: "P0/P1=0" },
		box,
	);
	assert.equal(ticket.review_head, "1a2b3c4d5e6f");
	assert.equal(reviewStaleness(ticket), undefined);

	setTicket(order, "MP-1", { head: "1a2b3c4" }, box);
	assert.equal(reviewStaleness(ticket), undefined, "the same commit, shorter");

	setTicket(order, "MP-1", { head: "2b3c4d5" }, box);
	assert.deepEqual(reviewStaleness(ticket), {
		reviewed: "1a2b3c4d5e6f",
		head: "2b3c4d5",
	});
	assert.match(order.log.at(-1)?.event ?? "", /review stale/);

	setTicket(order, "MP-1", { review: "P0/P1=0 again" }, box);
	assert.equal(reviewStaleness(ticket), undefined);
});

test("carry fills in a ticket claimed without its history, revives one that left, and refuses a done one", () => {
	const source = newOrder("app/2026-11-11-a", box);
	addTickets(source, ["MP-1", "MP-2", "MP-3"], box);
	for (const id of ["MP-1", "MP-2", "MP-3"]) {
		setTicket(
			source,
			id,
			{
				branch: `agent/${id}`,
				mr: "!812",
				head: "1a2b3c4",
				review: "P0/P1=0",
				tests: ["bun test = pass"],
			},
			box,
		);
	}
	const dest = newOrder("app/2026-11-11-b", box);
	// MP-1 was claimed again without history and got a new head since;
	// MP-2 was here before and dropped
	addTickets(dest, ["MP-1", "MP-2"], box);
	setTicket(dest, "MP-1", { head: "2b3c4d5", tests: ["bun test = pass"] }, mac);
	dropTicket(dest, "MP-2", "later", box);

	const carried = adoptCarried(dest, source.id, source.tickets, mac);

	assert.deepEqual(carried, ["MP-1", "MP-2", "MP-3"]);
	const [one, two, three] = dest.tickets;
	assert.equal(one.head, "2b3c4d5", "its own head stays");
	assert.equal(one.mr, "!812");
	assert.deepEqual(reviewStaleness(one), {
		reviewed: "1a2b3c4",
		head: "2b3c4d5",
	});
	assert.deepEqual(
		one.tests.map((r) => r.sha),
		["1a2b3c4", "2b3c4d5"],
	);
	assert.equal(two.state, "in-progress");
	assert.equal(two.reason, undefined);
	assert.equal(two.branch, "agent/MP-2");
	assert.equal(three.carried_from?.order, source.id);
	// A second carry from the same source changes nothing
	assert.deepEqual(adoptCarried(dest, source.id, source.tickets, mac), []);

	assert.deepEqual(markCarriedAway(source, ["MP-1", "MP-2"], dest.id, mac), [
		"MP-1",
		"MP-2",
	]);
	assert.equal(source.tickets[0].reason, `carried to ${dest.id}`);
	assert.deepEqual(markCarriedAway(source, ["MP-1"], dest.id, mac), []);

	markInReview(dest, ["MP-1", "MP-2", "MP-3"], mac);
	sealOrder(dest, "5d6e7f8", mac);
	assert.throws(
		() => adoptCarried(dest, source.id, source.tickets, mac),
		/takes no more tickets/,
	);
	assert.throws(
		() => adoptCarried(source, source.id, source.tickets, mac),
		/from itself/,
	);
});

test("a return notice lands on a handed-off copy once, and does not undo a carry made since", () => {
	const coordinator = sealedOrder();
	handOff(coordinator, box);
	const integrator = adoptImported(
		structuredClone(coordinator),
		undefined,
		mac,
		false,
	);
	setTicket(integrator, "MP-2", { head: "1a2b3c4" }, mac);
	returnTickets(integrator, ["MP-2"], "pair not ready", mac);
	const notice = buildReturnNotice(integrator, ["MP-1", "MP-2"], mac);
	assert.deepEqual(
		notice.tickets.map((t) => t.id),
		["MP-2"],
		"only returned tickets travel",
	);

	assert.deepEqual(applyReturnNotice(coordinator, notice, box), ["MP-2"]);
	assert.equal(coordinator.tickets[1].state, "returned");
	assert.equal(coordinator.tickets[1].head, "1a2b3c4", "the writer's record");
	assert.ok(coordinator.handed_off);
	assert.deepEqual(applyReturnNotice(coordinator, notice, box), []);

	reclaim(coordinator, box);
	markCarriedAway(coordinator, ["MP-2"], "app/2026-11-11-b", box);
	assert.deepEqual(applyReturnNotice(coordinator, notice, box), []);
	assert.equal(coordinator.tickets[1].state, "dropped");

	assert.throws(
		() => applyReturnNotice(newOrder("app/other", box), notice, box),
		/is for order app\/2026-11-11-a/,
	);
});
