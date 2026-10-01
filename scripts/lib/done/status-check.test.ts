import { test } from "bun:test";
import assert from "node:assert/strict";
import type { Task } from "../../utils.js";
import { describeNotInProgress, syncUntilStatus } from "./status-check.js";

function taskWithStatus(status: string): Task {
	return { id: "MP-1", status, localStatus: "pending" } as Task;
}

test("a pending task is told how to proceed: claim first or --from-remote", () => {
	const message = describeNotInProgress({
		id: "MP-2715",
		localStatus: "pending",
	});

	assert.match(message, /MP-2715/);
	assert.match(message, /目前: pending/);
	assert.match(message, /ttt claim MP-2715/);
	assert.match(message, /ttt done MP-2715 --from-remote/);
});

test("an already completed task is not told to claim it again", () => {
	const message = describeNotInProgress({
		id: "MP-1",
		localStatus: "completed",
	});

	assert.doesNotMatch(message, /ttt claim/);
	assert.match(message, /--from-remote/);
});

test("syncUntilStatus keeps syncing while the remote still shows the old status", async () => {
	const seen = ["Done", "Done", "Testing"];
	let calls = 0;
	const sleeps: number[] = [];

	const task = await syncUntilStatus(
		async () => taskWithStatus(seen[calls++]),
		"Testing",
		{ delayMs: 5, sleep: async (ms) => void sleeps.push(ms) },
	);

	assert.equal(task?.status, "Testing");
	assert.equal(calls, 3);
	assert.deepEqual(sleeps, [5, 5]);
});

test("syncUntilStatus gives up after the attempt budget and returns the last read", async () => {
	let calls = 0;

	const task = await syncUntilStatus(
		async () => {
			calls++;
			return taskWithStatus("Done");
		},
		"Testing",
		{ attempts: 3, sleep: async () => {} },
	);

	assert.equal(task?.status, "Done");
	assert.equal(calls, 3);
});

test("syncUntilStatus syncs once when nothing is expected or it already matches", async () => {
	let calls = 0;
	const sync = async () => {
		calls++;
		return taskWithStatus("Testing");
	};

	await syncUntilStatus(sync, undefined, { sleep: async () => {} });
	await syncUntilStatus(sync, "Testing", { sleep: async () => {} });

	assert.equal(calls, 2);
});
