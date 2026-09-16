import { test } from "bun:test";
import assert from "node:assert/strict";
import { findTaskByIssueId, type Task } from "./utils.js";

function task(id: string): Task {
	return {
		id,
		linearId: `uuid-${id}`,
		title: `Task ${id}`,
		status: "Todo",
		localStatus: "pending",
		priority: 0,
		labels: [],
	};
}

test("findTaskByIssueId matches a full ID for any team prefix", () => {
	const tasks = [task("MP-624"), task("QA-77"), task("INFRA-5")];

	assert.equal(findTaskByIssueId(tasks, "QA-77")?.id, "QA-77");
	assert.equal(findTaskByIssueId(tasks, "INFRA-5")?.id, "INFRA-5");
});

test("findTaskByIssueId resolves a bare number without assuming the MP prefix", () => {
	const tasks = [task("QA-77"), task("INFRA-5")];

	assert.equal(findTaskByIssueId(tasks, "77")?.id, "QA-77");
	assert.equal(findTaskByIssueId(tasks, "5")?.id, "INFRA-5");
});

test("findTaskByIssueId refuses to guess when a bare number spans teams", () => {
	const tasks = [task("MP-1"), task("QA-1")];

	assert.equal(findTaskByIssueId(tasks, "1"), undefined);
});

test("findTaskByIssueId returns undefined for an unknown ID", () => {
	const tasks = [task("MP-624")];

	assert.equal(findTaskByIssueId(tasks, "MP-999"), undefined);
	assert.equal(findTaskByIssueId(tasks, "999"), undefined);
});
