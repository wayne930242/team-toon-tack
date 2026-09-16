import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decode, encode } from "@toon-format/toon";

interface StoredTask {
	id: string;
	localStatus: string;
}

function task(id: string, priority: number, localStatus: string) {
	return {
		id,
		linearId: `uuid-${id}`,
		sourceId: `uuid-${id}`,
		sourceType: "linear",
		title: `Task ${id}`,
		status: localStatus === "completed" ? "Done" : "Todo",
		localStatus,
		assignee: "me@example.com",
		priority,
		labels: ["backend"],
	};
}

/** Local-only workspace so claiming never reaches a remote source. */
function makeWorkspace(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "ttt-claim-test-"));

	writeFileSync(
		path.join(dir, "config.toon"),
		encode({
			teams: { dev: { id: "team-dev", name: "Dev" } },
			users: { me: { id: "u1", email: "me@example.com", displayName: "Me" } },
			status_transitions: {
				todo: "Todo",
				in_progress: "In Progress",
				done: "Done",
			},
		}),
	);
	writeFileSync(
		path.join(dir, "local.toon"),
		encode({ current_user: "me", team: "dev", status_source: "local" }),
	);
	writeFileSync(
		path.join(dir, "cycle.toon"),
		encode({
			cycleId: "c1",
			cycleName: "Cycle 1",
			updatedAt: "2026-09-01T00:00:00.000Z",
			tasks: [
				task("MP-1", 3, "pending"),
				task("MP-2", 1, "pending"),
				task("MP-3", 4, "completed"),
			],
		}),
	);

	return dir;
}

function readStatuses(dir: string): Record<string, string> {
	const stored = decode(readFileSync(path.join(dir, "cycle.toon"), "utf8"), {
		strict: false,
	}) as unknown as { tasks: StoredTask[] };
	return Object.fromEntries(stored.tasks.map((t) => [t.id, t.localStatus]));
}

async function runClaim(dir: string, args: string[]) {
	const proc = Bun.spawn(
		["bun", path.join(import.meta.dirname, "claim.ts"), ...args],
		{ env: { ...process.env, TOON_DIR: dir }, stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	await proc.exited;
	return { stdout, stderr, exitCode: proc.exitCode };
}

test("ttt claim moves every claimable ticket in the batch to in-progress", async () => {
	const dir = makeWorkspace();

	const { stdout, exitCode } = await runClaim(dir, ["MP-1", "MP-2", "MP-3"]);

	assert.equal(exitCode, 0);
	assert.deepEqual(readStatuses(dir), {
		"MP-1": "in-progress",
		"MP-2": "in-progress",
		"MP-3": "completed",
	});
	assert.match(stdout, /Local: MP-1 → in-progress/);
	assert.match(stdout, /Local: MP-2 → in-progress/);
	assert.match(stdout, /MP-3 已完成/);
});

test("ttt claim next <n> claims the top n pending tickets by priority", async () => {
	const dir = makeWorkspace();

	const { stdout } = await runClaim(dir, ["next", "2"]);

	// MP-2 is urgent (1), MP-1 is medium (3), MP-3 is already completed.
	assert.match(stdout, /Auto-selected: MP-2, MP-1/);
	assert.deepEqual(readStatuses(dir), {
		"MP-1": "in-progress",
		"MP-2": "in-progress",
		"MP-3": "completed",
	});
});

test("ttt claim aborts the whole batch when any issue ID is unknown", async () => {
	const dir = makeWorkspace();

	const { stderr, exitCode } = await runClaim(dir, ["MP-1", "MP-999"]);

	assert.notEqual(exitCode, 0, "an unknown ID must not report success");
	assert.match(stderr, /MP-999 not found/);
	assert.deepEqual(
		readStatuses(dir),
		{ "MP-1": "pending", "MP-2": "pending", "MP-3": "completed" },
		"no ticket may be claimed when the batch cannot be fully resolved",
	);
});

test("ttt claim --dry-run leaves every ticket untouched", async () => {
	const dir = makeWorkspace();

	const { stdout } = await runClaim(dir, ["MP-1", "MP-2", "--dry-run"]);

	assert.match(stdout, /\(dry-run: no changes made\)/);
	assert.deepEqual(readStatuses(dir), {
		"MP-1": "pending",
		"MP-2": "pending",
		"MP-3": "completed",
	});
});
