import { test } from "bun:test";
import assert from "node:assert/strict";
import {
	addTickets,
	adoptImported,
	closeIfComplete,
	dropTicket,
	handOff,
	markInReview,
	markTicketDone,
	newOrder,
	nextCode,
	parseOrderId,
	parseTestRun,
	reclaim,
	recordMerge,
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
