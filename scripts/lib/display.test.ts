import { afterEach, beforeEach, test } from "bun:test";
import assert from "node:assert/strict";
import type { Task } from "../utils.js";
import { displayTaskFull } from "./display.js";

const task = {
	id: "MP-2711",
	linearId: "uuid",
	title: "Sample",
	status: "Testing",
	localStatus: "pending",
	priority: 2,
	labels: ["Backend-v3"],
} as Task;

let logs: string[] = [];
const realLog = console.log;
beforeEach(() => {
	logs = [];
	console.log = (...args: unknown[]) => void logs.push(args.join(" "));
});
afterEach(() => {
	console.log = realLog;
});

test("detail view with status option prints the source status and Unassigned", () => {
	displayTaskFull(task, "📋", { status: { local: false } });

	assert.ok(logs.includes("Status: Testing"));
	assert.ok(logs.includes("Assignee: Unassigned"));
	assert.ok(!logs.some((line) => line.includes("Local:")));
});

test("detail view includes the local status when a local copy exists", () => {
	displayTaskFull({ ...task, assignee: "a@b.c" }, "📋", {
		status: { local: true },
	});

	assert.ok(logs.includes("Status: Testing (Local: pending)"));
	assert.ok(logs.includes("Assignee: a@b.c"));
});

test("without the option the detail view is unchanged (claim output)", () => {
	displayTaskFull(task, "📋");

	assert.ok(!logs.some((line) => line.startsWith("Status:")));
	assert.ok(!logs.some((line) => line.startsWith("Assignee:")));
});
