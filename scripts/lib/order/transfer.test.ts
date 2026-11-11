import { test } from "bun:test";
import assert from "node:assert/strict";
import {
	addTickets,
	handOff,
	markInReview,
	newOrder,
	sealOrder,
	setTicket,
} from "./model.js";
import {
	extractOrderBlocks,
	pickOrderBlock,
	renderOrderBlock,
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
