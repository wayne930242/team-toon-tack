import { test } from "bun:test";
import assert from "node:assert/strict";
import {
	type ChildIssueState,
	listUnfinishedSiblings,
} from "./parent-issue.js";

const done = { name: "Done", type: "completed" };
const canceled = { name: "Canceled", type: "canceled" };
const inProgress = { name: "In Progress", type: "started" };
const testing = { name: "Testing", type: "started" };

test("keeps the parent while other sub-issues are still in progress", () => {
	const children: ChildIssueState[] = [
		{ identifier: "MP-2269", state: done },
		{ identifier: "PM-821", state: done },
		{ identifier: "PM-818", state: inProgress },
		{ identifier: "PM-826", state: testing },
		{ identifier: "MP-2268", state: done },
		{ identifier: "PM-820", state: inProgress },
		{ identifier: "PM-817", state: inProgress },
	];

	assert.deepEqual(listUnfinishedSiblings(children, "MP-2269", ["Testing"]), [
		"PM-818",
		"PM-820",
		"PM-817",
	]);
});

test("releases the parent once every other sub-issue is done, canceled or handed off", () => {
	const children: ChildIssueState[] = [
		{ identifier: "MP-1", state: inProgress },
		{ identifier: "MP-2", state: done },
		{ identifier: "MP-3", state: canceled },
		{ identifier: "PM-4", state: testing },
	];

	assert.deepEqual(listUnfinishedSiblings(children, "MP-1", ["Testing"]), []);
});

test("without hand-off statuses, testing and stateless sub-issues stay unfinished", () => {
	const children: ChildIssueState[] = [
		{ identifier: "MP-1", state: done },
		{ identifier: "MP-2", state: testing },
		{ identifier: "MP-3" },
	];

	assert.deepEqual(listUnfinishedSiblings(children, "MP-1", []), [
		"MP-2",
		"MP-3",
	]);
});
