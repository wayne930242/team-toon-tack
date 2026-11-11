import { afterEach, beforeEach, test } from "bun:test";
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	handOff,
	markInReview,
	returnTickets,
	sealOrder,
	setTicket,
} from "./model.js";
import {
	addClaimedTickets,
	annotateOrder,
	carryTickets,
	checkClaimTarget,
	defaultProject,
	findTicketSource,
	listOrders,
	loadOrder,
	openOrder,
	updateOrder,
} from "./store.js";
import { OrderError } from "./types.js";

const stamp = { by: "coord@box", at: "2026-11-11T01:00:00.000Z" };
let dir: string;
let previousDir: string | undefined;

beforeEach(() => {
	previousDir = process.env.TOON_DIR;
	dir = path.join(mkdtempSync(path.join(tmpdir(), "ttt-order-store-")), ".ttt");
	mkdirSync(dir);
	process.env.TOON_DIR = dir;
});

afterEach(() => {
	if (previousDir === undefined) delete process.env.TOON_DIR;
	else process.env.TOON_DIR = previousDir;
});

test("orders are stored as .ttt/orders/<project>/<code>.toon and read back", async () => {
	const opened = await openOrder(
		{ project: "app", reviewer: "integ@mac" },
		stamp,
	);

	assert.equal(opened.id, "app/2026-11-11-a");
	assert.ok(existsSync(path.join(dir, "orders/app/2026-11-11-a.toon")));
	assert.deepEqual(await loadOrder(opened.id), opened);
	assert.equal(opened.rev, 1);
	await assert.rejects(loadOrder("app/nope"), /not found.*ttt order list/);
});

test("--order auto fills the open order, and opens the next letter once it is sealed", async () => {
	const target = { order: "auto", project: "app" };
	assert.equal(await checkClaimTarget(target, ["MP-1"]), null);

	const first = await addClaimedTickets(target, ["MP-1"], stamp);
	const again = await addClaimedTickets(target, ["MP-2", "MP-1"], stamp);
	assert.equal(first.created, true);
	assert.equal(again.order.id, "app/2026-11-11-a");
	assert.deepEqual(again.added, ["MP-2"]);

	await updateOrder(again.order.id, (o) => {
		markInReview(o, ["MP-1", "MP-2"], stamp);
		sealOrder(o, "5d6e7f8", stamp);
	});
	await assert.rejects(
		checkClaimTarget({ order: "app/2026-11-11-a" }, ["MP-3"]),
		/sealed and takes no more tickets/,
	);

	const next = await addClaimedTickets(target, ["MP-3"], stamp);
	assert.equal(next.order.id, "app/2026-11-11-b");
	assert.deepEqual(
		(await listOrders("app")).map((o) => `${o.id} ${o.stage}`),
		["app/2026-11-11-a sealed", "app/2026-11-11-b open"],
	);
});

test("a ticket riding one order cannot be claimed into another", async () => {
	const target = { order: "auto", project: "app" };
	const { order } = await addClaimedTickets(target, ["MP-1"], stamp);
	await updateOrder(order.id, (o) => {
		markInReview(o, ["MP-1"], stamp);
		sealOrder(o, "5d6e7f8", stamp);
	});

	await assert.rejects(
		checkClaimTarget(target, ["MP-1", "MP-2"]),
		/MP-1 already in order app\/2026-11-11-a.*ttt order drop/,
	);
	await assert.rejects(addClaimedTickets(target, ["MP-1"], stamp), OrderError);
	assert.equal((await listOrders("app")).length, 1, "no order opened for it");
});

test("a project holds one open order at a time", async () => {
	await openOrder({ project: "app" }, stamp);
	await assert.rejects(
		openOrder({ project: "app" }, stamp),
		/already has an open order, app\/2026-11-11-a/,
	);
	await openOrder({ project: "web", code: "train-7" }, stamp);
	assert.deepEqual(
		(await listOrders()).map((o) => o.id),
		["app/2026-11-11-a", "web/train-7"],
	);
});

test("concurrent writers all land: no update is lost and no temp file stays", async () => {
	const { order } = await addClaimedTickets(
		{ order: "auto", project: "app" },
		Array.from({ length: 12 }, (_, i) => `MP-${i}`),
		stamp,
	);

	await Promise.all(
		order.tickets.map((t) =>
			updateOrder(order.id, (o) => {
				setTicket(o, t.id, { mr: `!${t.id}` }, stamp);
			}),
		),
	);

	const stored = await loadOrder(order.id);
	assert.deepEqual(
		stored.tickets.map((t) => t.mr),
		order.tickets.map((t) => `!${t.id}`),
	);
	assert.equal(stored.rev, order.rev + 12);
	assert.deepEqual(readdirSync(path.join(dir, "orders/app")), [
		"2026-11-11-a.toon",
	]);
});

test("a refused change writes nothing", async () => {
	const { order } = await addClaimedTickets(
		{ order: "auto", project: "app" },
		["MP-1"],
		stamp,
	);

	await assert.rejects(
		updateOrder(order.id, (o) => {
			o.tickets[0].mr = "!half-done";
			sealOrder(o, "5d6e7f8", stamp);
		}),
		/Cannot seal/,
	);

	assert.deepEqual(await loadOrder(order.id), order);
});

test("a lock left by a dead process is taken over", async () => {
	const { order } = await addClaimedTickets(
		{ order: "auto", project: "app" },
		["MP-1"],
		stamp,
	);
	const lock = path.join(dir, "orders/app/.lock");

	writeFileSync(lock, "999999@gone 2026-11-11T00:00:00.000Z\n");
	const old = new Date(Date.now() - 60_000);
	utimesSync(lock, old, old);
	await updateOrder(order.id, (o) => {
		setTicket(o, "MP-1", { mr: "!1" }, stamp);
	});
	assert.equal((await loadOrder(order.id)).tickets[0].mr, "!1");
	assert.equal(existsSync(lock), false);
});

test("the default project is the directory that holds .ttt", () => {
	assert.match(defaultProject(), /^ttt-order-store-/);
});

test("an order file that lost a row is refused", async () => {
	const opened = await openOrder({ project: "app" }, stamp);
	await updateOrder(opened.id, (o) => {
		markInReview(o, [], stamp);
		o.log.push({ ...o.log[0] });
	});
	const file = path.join(dir, "orders/app/2026-11-11-a.toon");
	const lines = readFileSync(file, "utf8").split("\n");
	const header = lines.findIndex((line) => /^log\[\d+\]/.test(line));
	lines.splice(header + 1, 1);
	writeFileSync(file, lines.join("\n"));

	await assert.rejects(loadOrder(opened.id), /2026-11-11-a\.toon: .*rows/);
});

test("releasing leaves a lock another process took over in place", async () => {
	const opened = await openOrder({ project: "app" }, stamp);
	const lock = path.join(dir, "orders/app/.lock");
	const theirs = "4242@other 2026-11-11T01:00:00.000Z\n";

	await updateOrder(opened.id, () => {
		// Our lock went stale and someone else took it while we worked
		writeFileSync(lock, theirs);
	});

	assert.equal(readFileSync(lock, "utf8"), theirs);
});

test("taking over a stale lock leaves no stray files", async () => {
	const opened = await openOrder({ project: "app" }, stamp);
	const lock = path.join(dir, "orders/app/.lock");
	writeFileSync(lock, "999999@gone 2026-11-11T00:00:00.000Z\n");
	const old = new Date(Date.now() - 60_000);
	utimesSync(lock, old, old);

	await Promise.all([
		updateOrder(opened.id, () => false),
		updateOrder(opened.id, () => false),
	]);

	assert.deepEqual(
		readdirSync(path.join(dir, "orders/app")).filter((f) => f.startsWith(".")),
		[],
	);
});

test("carry refuses a ticket another order of the project holds, and a returned one is free to claim", async () => {
	const target = { order: "auto", project: "app" };
	// Order a: MP-1 returned, MP-2 in review, sealed
	const first = await addClaimedTickets(target, ["MP-1", "MP-2"], stamp);
	const a = await updateOrder(first.order.id, (o) => {
		markInReview(o, ["MP-1", "MP-2"], stamp);
		sealOrder(o, "5d6e7f8", stamp);
		returnTickets(o, ["MP-1"], "pulled", stamp);
	});
	const [returned, held] = a.tickets;
	// Order b took MP-1 again, without its history, and was sealed too
	const second = await addClaimedTickets(target, ["MP-1"], stamp);
	assert.equal(second.order.id, "app/2026-11-11-b", "returned: free to claim");
	await updateOrder(second.order.id, (o) => {
		markInReview(o, ["MP-1"], stamp);
		sealOrder(o, "6e7f8a9", stamp);
	});
	assert.equal(
		(await findTicketSource("app", "MP-1", null))?.id,
		"app/2026-11-11-b",
		"the newest order that holds the ticket",
	);
	assert.equal(
		(await findTicketSource("app", "MP-1", "app/2026-11-11-b"))?.id,
		a.id,
	);

	await assert.rejects(
		carryTickets(target, [{ sourceId: a.id, ticket: returned }], stamp),
		/MP-1 already in order app\/2026-11-11-b/,
	);
	assert.equal((await listOrders("app")).length, 2, "no order was opened");

	// The source's own hold does not count
	const carried = await carryTickets(
		target,
		[{ sourceId: a.id, ticket: held }],
		stamp,
	);
	assert.equal(carried.order.id, "app/2026-11-11-c");
	assert.deepEqual(carried.carried, ["MP-2"]);
	assert.equal(carried.created, true);
});

test("a note on a handed-off copy keeps its revision; on a writable copy it counts", async () => {
	const { order } = await addClaimedTickets(
		{ order: "auto", project: "app" },
		["MP-1"],
		stamp,
	);
	const touch = (o: { reviewer?: string }) => {
		o.reviewer = `${o.reviewer ?? ""}x`;
		return true;
	};

	const writable = await annotateOrder(order.id, touch);
	assert.equal(writable.rev, order.rev + 1);
	assert.equal((await annotateOrder(order.id, () => false)).rev, writable.rev);

	const handed = await updateOrder(order.id, (o) => handOff(o, stamp));
	const noted = await annotateOrder(order.id, touch);
	assert.equal(noted.rev, handed.rev);
	assert.equal((await loadOrder(order.id)).reviewer, "xx");
});
