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
		{
			env: { ...process.env, TOON_DIR: dir, LINEAR_API_KEY: "" },
			stdout: "pipe",
			stderr: "pipe",
		},
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

/** Remote-source workspace: claiming reaches the fake Linear API. */
function makeRemoteWorkspace(): string {
	const dir = makeWorkspace();
	writeFileSync(
		path.join(dir, "local.toon"),
		encode({ current_user: "me", team: "dev", status_source: "remote" }),
	);
	return dir;
}

async function runClaimRemote(dir: string, args: string[]) {
	const log = path.join(dir, "requests.jsonl");
	writeFileSync(log, "");
	const proc = Bun.spawn(
		[
			"bun",
			"--preload",
			path.join(import.meta.dirname, "test-support/linear-mock.ts"),
			path.join(import.meta.dirname, "claim.ts"),
			...args,
		],
		{
			env: {
				...process.env,
				TOON_DIR: dir,
				LINEAR_API_KEY: "test-key",
				MOCK_LINEAR_LOG: log,
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	await proc.exited;
	const requests = readFileSync(log, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as { name: string; variables: unknown });
	return { stdout, stderr, exitCode: proc.exitCode, requests };
}

test("ttt claim fetches a ticket missing from local data, stores it, and moves it to In Progress", async () => {
	const dir = makeRemoteWorkspace();

	const { stdout, exitCode, requests } = await runClaimRemote(dir, ["MP-7"]);

	assert.equal(exitCode, 0);
	assert.deepEqual(readStatuses(dir)["MP-7"], "in-progress");
	assert.equal(
		readStatuses(dir)["MP-1"],
		"pending",
		"existing tasks stay untouched",
	);
	assert.match(stdout, /Linear: MP-7 → In Progress/);
	const update = requests.find((r) => r.name === "updateIssue");
	assert.deepEqual(
		(update?.variables as { id?: string; input?: { stateId?: string } })?.input,
		{ stateId: "s-progress" },
	);
});

test("ttt claim --dry-run on a remote-only ticket stores nothing", async () => {
	const dir = makeRemoteWorkspace();

	const { stdout, exitCode } = await runClaimRemote(dir, ["MP-7", "--dry-run"]);

	assert.equal(exitCode, 0);
	assert.match(stdout, /MP-7/);
	assert.equal(readStatuses(dir)["MP-7"], undefined);
});

async function runClaimRemoteInState(
	dir: string,
	args: string[],
	state: string,
) {
	process.env.MOCK_LINEAR_ISSUE_STATE = state;
	try {
		return await runClaimRemote(dir, args);
	} finally {
		delete process.env.MOCK_LINEAR_ISSUE_STATE;
	}
}

test("ttt claim skips a remote-only ticket that is already canceled", async () => {
	const dir = makeRemoteWorkspace();

	const { stdout, requests } = await runClaimRemoteInState(
		dir,
		["MP-7"],
		"s-canceled",
	);

	assert.match(stdout, /MP-7 已完成/);
	assert.equal(readStatuses(dir)["MP-7"], undefined);
	assert.equal(
		requests.some((r) => r.name === "updateIssue"),
		false,
		"a closed ticket must not be reopened",
	);
});

test("ttt claim stores a remote-only ticket that is already in progress without touching the source", async () => {
	const dir = makeRemoteWorkspace();

	const { stdout, requests } = await runClaimRemoteInState(
		dir,
		["MP-7"],
		"s-progress",
	);

	assert.match(stdout, /MP-7 已在進行中/);
	assert.equal(readStatuses(dir)["MP-7"], "in-progress");
	assert.equal(
		requests.some((r) => r.name === "updateIssue"),
		false,
	);
});
