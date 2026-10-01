import { test } from "bun:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { encode } from "@toon-format/toon";

/** Trello + status_source=local workspace so `ttt done` never reaches a remote. */
function makeWorkspace(localStatus: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), "ttt-done-test-"));

	writeFileSync(
		path.join(dir, "config.toon"),
		encode({
			source: { type: "trello" },
			teams: { dev: { id: "board-1", name: "Dev" } },
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
				{
					id: "MP-1",
					linearId: "card-1",
					sourceId: "card-1",
					sourceType: "trello",
					title: "Task MP-1",
					status: "Todo",
					localStatus,
					assignee: "me@example.com",
					priority: 3,
					labels: ["backend"],
				},
			],
		}),
	);

	return dir;
}

/** A repo with an older commit and a newer HEAD, so --commit is distinguishable. */
function makeRepo(): { dir: string; firstHash: string; headHash: string } {
	const dir = mkdtempSync(path.join(tmpdir(), "ttt-done-repo-"));
	const run = (cmd: string) =>
		execSync(cmd, { cwd: dir, encoding: "utf-8" }).trim();

	run("git init -q");
	run('git config user.email "test@example.com"');
	run('git config user.name "Test"');
	writeFileSync(path.join(dir, "f.txt"), "1\n");
	run("git add f.txt");
	run('git commit -q -m "older ticket commit"');
	writeFileSync(path.join(dir, "f.txt"), "2\n");
	run("git add f.txt");
	run('git commit -q -m "newer unrelated commit"');

	return {
		dir,
		firstHash: run("git rev-parse HEAD~1"),
		headHash: run("git rev-parse HEAD"),
	};
}

async function runDone(dir: string, args: string[], cwd?: string) {
	const proc = Bun.spawn(
		["bun", path.join(import.meta.dirname, "done-job.ts"), ...args],
		{
			cwd,
			env: { ...process.env, TOON_DIR: dir },
			stdin: "ignore",
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

test("ttt done on a pending ticket fails with a hint naming claim and --from-remote", async () => {
	const dir = makeWorkspace("pending");

	const { stdout, stderr, exitCode } = await runDone(dir, ["MP-1"]);

	assert.equal(exitCode, 1);
	assert.match(stderr, /MP-1 不在進行中狀態 \(目前: pending\)/);
	assert.match(stderr, /ttt claim MP-1/);
	assert.match(stderr, /ttt done MP-1 --from-remote/);
	assert.doesNotMatch(stdout, /沒有進行中的任務/);
});

test("ttt done --commit/--repo records that commit, not HEAD of the cwd", async () => {
	const dir = makeWorkspace("in-progress");
	const repo = makeRepo();

	const { stdout, exitCode } = await runDone(
		dir,
		["MP-1", "-m", "fixed", "--commit", repo.firstHash, "--repo", repo.dir],
		tmpdir(),
	);

	assert.equal(exitCode, 0);
	assert.match(stdout, new RegExp(`Commit: ${repo.firstHash.slice(0, 7)}`));
	assert.match(stdout, /older ticket commit/);
	assert.doesNotMatch(stdout, /newer unrelated commit/);
});

test("ttt done --commit with an unreadable commit changes nothing and exits non-zero", async () => {
	const dir = makeWorkspace("in-progress");
	const repo = makeRepo();

	const { stderr, exitCode } = await runDone(
		dir,
		["MP-1", "--commit", "deadbeefnotacommit", "--repo", repo.dir],
		tmpdir(),
	);

	assert.equal(exitCode, 1);
	assert.match(stderr, /Cannot read commit deadbeefnotacommit/);
});

test("ttt done reports a missing option value with a non-zero exit", async () => {
	const dir = makeWorkspace("in-progress");

	const { stderr, exitCode } = await runDone(dir, ["MP-1", "--commit"]);

	assert.notEqual(exitCode, 0);
	assert.match(stderr, /--commit requires a value/);
});
