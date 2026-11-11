import { test } from "bun:test";
import assert from "node:assert/strict";
import {
	addTickets,
	buildReturnNotice,
	handOff,
	markInReview,
	newOrder,
	reclaim,
	returnTickets,
	sealOrder,
	setTicket,
} from "./model.js";
import {
	extractOrderBlocks,
	extractReturnNotices,
	pickOrderBlock,
	readBlocks,
	renderOrderBlock,
	renderReturnBlock,
} from "./transfer.js";
import { OrderError, type WorkOrder } from "./types.js";

const box = { by: "coord@box", at: "2026-11-11T01:00:00.000Z" };

function order(id = "app/2026-11-11-a"): WorkOrder {
	const o = newOrder(id, box, "integ@mac");
	addTickets(o, ["MP-1", "MP-2"], box);
	setTicket(
		o,
		"MP-1",
		{
			branch: "feat/mp-1",
			mr: "!812",
			head: "1234567",
			review: "P0/P1=0, notes: none",
			tests: ["bun test scripts/x --filter=a,b = pass"],
		},
		box,
	);
	markInReview(o, ["MP-1", "MP-2"], box);
	sealOrder(o, "5d6e7f8", box);
	handOff(o, box);
	return o;
}

test("an exported block comes back unchanged out of an MR description", () => {
	const original = order();
	const description = [
		"## agent-train/2026-11-11-a",
		"",
		"Cars: MP-1, MP-2",
		"",
		"```bash",
		"bun test",
		"```",
		"",
		renderOrderBlock(original),
		"",
		"/cc @integ",
	].join("\r\n");

	assert.deepEqual(pickOrderBlock(description), original);
});

test("a description whose newlines were stored as <br> still yields the block", () => {
	const original = order();
	const description = ["## Train", "", renderOrderBlock(original), ""]
		.join("\n")
		.replace(/\n/g, "<br>");

	assert.deepEqual(pickOrderBlock(description), original);
	assert.deepEqual(
		pickOrderBlock(description.replace(/<br>/g, "<br />")),
		original,
	);
});

test("the block survives being indented inside a list", () => {
	const original = order();
	const indented = renderOrderBlock(original)
		.split("\n")
		.map((line) => `   ${line}`)
		.join("\n");

	assert.deepEqual(pickOrderBlock(`1. Work order:\n\n${indented}\n`), original);
});

test("text holding a code fence does not end the block early", () => {
	const original = order();
	setReview(original, "see ```diff``` in the MR");

	const block = renderOrderBlock(original);

	assert.match(block, /^````toon ttt-order\n/);
	assert.deepEqual(pickOrderBlock(block), original);
});

function setReview(o: WorkOrder, review: string): void {
	o.tickets[0].review = review;
}

test("several orders in one text need --id; the same order twice takes the newest", () => {
	const a = order("app/2026-11-11-a");
	const b = order("app/2026-11-11-b");
	const text = `${renderOrderBlock(a)}\n\n${renderOrderBlock(b)}`;

	assert.equal(extractOrderBlocks(text).length, 2);
	assert.throws(() => pickOrderBlock(text), /several work orders.*--id/);
	assert.equal(pickOrderBlock(text, "app/2026-11-11-b").id, "app/2026-11-11-b");
	assert.throws(
		() => pickOrderBlock(text, "app/x"),
		/No block for order app\/x/,
	);

	const newer = { ...a, rev: a.rev + 5 };
	assert.equal(
		pickOrderBlock(`${renderOrderBlock(newer)}\n${renderOrderBlock(a)}`).rev,
		newer.rev,
	);
});

test("text without a valid block is refused with what was expected", () => {
	assert.throws(
		() => pickOrderBlock("no order here"),
		/No work order block found/,
	);
	assert.throws(
		() => pickOrderBlock("```toon ttt-order\nid: app/x\nstage: bogus\n```"),
		OrderError,
	);
});

test("a block that lost a row is rejected, not imported short", () => {
	const block = renderOrderBlock(order());
	const lines = block.split("\n");
	const header = lines.findIndex((line) => /^log\[\d+\]/.test(line));
	lines.splice(header + 1, 1);

	assert.throws(
		() => extractOrderBlocks(lines.join("\n")),
		(error: unknown) =>
			error instanceof OrderError && /not valid TOON.*rows/.test(error.message),
	);
});

test("a return notice travels as its own block, beside an order block and through <br>", () => {
	const mac = { by: "integ@mac", at: "2026-11-11T05:00:00.000Z" };
	const original = order();
	const integrators = structuredClone(original);
	reclaim(integrators, mac);
	returnTickets(integrators, ["MP-1"], "pair `MP-9` not ready", mac);
	const notice = buildReturnNotice(integrators, ["MP-1"], mac);
	const block = renderReturnBlock(notice);
	assert.match(block, /^```toon ttt-return\n/);

	assert.deepEqual(extractReturnNotices(`Returned:\n\n${block}\n`), [notice]);
	assert.equal(notice.tickets[0].mr, "!812", "the whole record travels");
	assert.equal(notice.tickets[0].returned?.reason, "pair `MP-9` not ready");

	// Each reader takes only its own blocks
	const both = `${renderOrderBlock(original)}\n\n${block}\n`;
	assert.deepEqual(extractOrderBlocks(block), []);
	assert.deepEqual(pickOrderBlock(both), original);
	assert.deepEqual(readBlocks(both), { orders: [original], returns: [notice] });
	assert.throws(() => pickOrderBlock(block), /No work order block found/);

	assert.deepEqual(readBlocks(block.replace(/\n/g, "<br>")).returns, [notice]);

	const active = block.replace("state: returned", "state: in-review");
	assert.throws(() => extractReturnNotices(active), /not returned/);
});
