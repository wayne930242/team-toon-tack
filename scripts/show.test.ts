import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { encode } from "@toon-format/toon";

test("ttt show <id> prints the Status line", async () => {
	const dir = mkdtempSync(path.join(tmpdir(), "ttt-show-test-"));
	writeFileSync(
		path.join(dir, "config.toon"),
		encode({
			source: { type: "trello" },
			teams: { dev: { id: "board-1", name: "Dev" } },
			users: {},
		}),
	);
	writeFileSync(
		path.join(dir, "local.toon"),
		encode({ current_user: "me", team: "dev" }),
	);
	writeFileSync(
		path.join(dir, "cycle.toon"),
		encode({
			cycleId: "c1",
			cycleName: "Cycle 1",
			updatedAt: "2026-09-01T00:00:00.000Z",
			tasks: [
				{
					id: "MP-1",
					linearId: "card-1",
					title: "Task MP-1",
					status: "In Progress",
					localStatus: "in-progress",
					priority: 3,
					labels: [],
				},
			],
		}),
	);

	const proc = Bun.spawn(
		["bun", path.join(import.meta.dirname, "show.ts"), "MP-1"],
		{
			env: { ...process.env, TOON_DIR: dir },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const stdout = await new Response(proc.stdout).text();
	await proc.exited;

	assert.match(stdout, /Status: In Progress \(Local: in-progress\)/);
	assert.match(stdout, /Assignee: Unassigned/);
});

interface LoggedRequest {
	name: string;
	variables: { filter?: Record<string, unknown> };
}

/** Linear workspace whose API is the fake in test-support/linear-mock.ts. */
function makeRemoteWorkspace(source: "linear" | "trello" = "linear"): string {
	const dir = mkdtempSync(path.join(tmpdir(), "ttt-show-remote-"));
	writeFileSync(
		path.join(dir, "config.toon"),
		encode({
			source: { type: source },
			teams: { dev: { id: "team-dev", name: "Dev" } },
			users: { me: { id: "u1", email: "me@example.com", displayName: "Me" } },
			status_transitions: {
				todo: "Todo",
				in_progress: "In Progress",
				done: "Done",
			},
			current_cycle: {
				id: "cycle-1",
				name: "Cycle 1",
				start_date: "2026-10-01",
				end_date: "2026-10-14",
			},
		}),
	);
	writeFileSync(
		path.join(dir, "local.toon"),
		encode({ current_user: "me", team: "dev" }),
	);
	return dir;
}

async function runShowRemote(dir: string, args: string[]) {
	const log = path.join(dir, "requests.jsonl");
	writeFileSync(log, "");
	const proc = Bun.spawn(
		[
			"bun",
			"--preload",
			path.join(import.meta.dirname, "test-support/linear-mock.ts"),
			path.join(import.meta.dirname, "show.ts"),
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
		.map((line) => JSON.parse(line) as LoggedRequest);
	return { stdout, stderr, exitCode: proc.exitCode, requests };
}

function issuesFilter(requests: LoggedRequest[]) {
	const request = requests.find((r) => r.name === "issues");
	assert.ok(request, "expected an issues query");
	return request.variables.filter ?? {};
}

test("ttt show --remote --status Backlog --creator me searches outside the cycle by creator, not assignee", async () => {
	const dir = makeRemoteWorkspace();

	const { stdout, exitCode, requests } = await runShowRemote(dir, [
		"--remote",
		"--status",
		"Backlog",
		"--creator",
		"me",
	]);

	assert.equal(exitCode, 0);
	const filter = issuesFilter(requests);
	assert.equal(filter.cycle, undefined, "a Backlog search has no cycle scope");
	assert.deepEqual(filter.state, { name: { in: ["Backlog"] } });
	assert.deepEqual(filter.creator, { email: { in: ["me@example.com"] } });
	assert.equal(
		filter.assignee,
		undefined,
		"creator search is not assignee-bound",
	);
	assert.match(stdout, /MP-7: Backlog follow-up/);
});

test("ttt show --remote keeps the cycle scope for a non-backlog status", async () => {
	const dir = makeRemoteWorkspace();

	const { requests } = await runShowRemote(dir, [
		"--remote",
		"--status",
		"Todo",
	]);

	assert.deepEqual(issuesFilter(requests).cycle, { id: { eq: "cycle-1" } });
});

test("ttt show --remote --any-cycle drops the cycle scope", async () => {
	const dir = makeRemoteWorkspace();

	const { requests } = await runShowRemote(dir, ["--remote", "--any-cycle"]);

	assert.equal(issuesFilter(requests).cycle, undefined);
});

test("ttt show --remote --creator <name> matches by name or email substring", async () => {
	const dir = makeRemoteWorkspace();

	const { requests } = await runShowRemote(dir, [
		"--remote",
		"--creator",
		"wei",
	]);

	assert.deepEqual(issuesFilter(requests).creator, {
		or: [
			{ name: { containsIgnoreCase: "wei" } },
			{ displayName: { containsIgnoreCase: "wei" } },
			{ email: { containsIgnoreCase: "wei" } },
		],
	});
});

test("ttt show --creator without --remote fails instead of ignoring the flag", async () => {
	const dir = makeRemoteWorkspace();

	const { stderr, exitCode } = await runShowRemote(dir, ["--creator", "me"]);

	assert.notEqual(exitCode, 0);
	assert.match(stderr, /--creator needs --remote/);
});

test("ttt show --remote --creator fails clearly on Trello", async () => {
	const dir = makeRemoteWorkspace("trello");

	const { stderr, exitCode } = await runShowRemote(dir, [
		"--remote",
		"--creator",
		"me",
	]);

	assert.notEqual(exitCode, 0);
	assert.match(stderr, /--creator is not supported for Trello/);
});

test("ttt show --creator without a value fails instead of swallowing the next flag", async () => {
	const dir = makeRemoteWorkspace();

	const { stderr, exitCode, requests } = await runShowRemote(dir, [
		"--creator",
		"--remote",
	]);

	assert.notEqual(exitCode, 0);
	assert.match(stderr, /--creator needs a value/);
	assert.equal(requests.length, 0);
});

test("ttt show --remote --creator <email> with --user keeps the assignee scope", async () => {
	const dir = makeRemoteWorkspace();

	const { requests } = await runShowRemote(dir, [
		"--remote",
		"--creator",
		"boss@example.com",
		"--user",
		"me",
	]);

	const filter = issuesFilter(requests);
	assert.deepEqual(filter.creator, { email: { in: ["boss@example.com"] } });
	assert.deepEqual(filter.assignee, { email: { in: ["me@example.com"] } });
});

test("ttt show --any-cycle without --remote fails instead of being ignored", async () => {
	const dir = makeRemoteWorkspace();

	const { stderr, exitCode } = await runShowRemote(dir, ["--any-cycle"]);

	assert.notEqual(exitCode, 0);
	assert.match(stderr, /--any-cycle needs --remote/);
});
