import { test } from "bun:test";
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decode, encode } from "@toon-format/toon";

interface StoredTask {
	id: string;
	localStatus: string;
}

/** A monorepo root holding `.ttt`, with a nested dir standing in for a git
 * submodule / per-ticket worktree underneath it. */
function makeWorkspace(): { ttt: string; nested: string } {
	const root = mkdtempSync(path.join(tmpdir(), "ttt-ancestor-test-"));
	const ttt = path.join(root, ".ttt");
	mkdirSync(ttt, { recursive: true });

	writeFileSync(
		path.join(ttt, "config.toon"),
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
		path.join(ttt, "local.toon"),
		encode({ current_user: "me", team: "dev", status_source: "local" }),
	);
	writeFileSync(
		path.join(ttt, "cycle.toon"),
		encode({
			cycleId: "c1",
			cycleName: "Cycle 1",
			updatedAt: "2026-09-01T00:00:00.000Z",
			tasks: [
				{
					id: "MP-1",
					linearId: "uuid-MP-1",
					sourceId: "uuid-MP-1",
					sourceType: "linear",
					title: "Task 1",
					status: "Todo",
					localStatus: "pending",
					assignee: "me@example.com",
					priority: 3,
					labels: [],
				},
			],
		}),
	);

	const nested = path.join(root, "apps", "worktree-a", "src");
	mkdirSync(nested, { recursive: true });

	return { ttt, nested };
}

function readStatuses(dir: string): Record<string, string> {
	const stored = decode(readFileSync(path.join(dir, "cycle.toon"), "utf8"), {
		strict: false,
	}) as unknown as { tasks: StoredTask[] };
	return Object.fromEntries(stored.tasks.map((t) => [t.id, t.localStatus]));
}

/** Runs `ttt status` from `cwd` with no TOON_DIR override, so it must resolve
 * `.ttt` by walking up from `cwd` on its own. */
async function runStatus(cwd: string, args: string[]) {
	const env = { ...process.env };
	delete env.TOON_DIR;
	delete env.LINEAR_TOON_DIR;

	const proc = Bun.spawn(
		["bun", path.join(import.meta.dirname, "status.ts"), ...args],
		{ cwd, env, stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	await proc.exited;
	return { stdout, stderr, exitCode: proc.exitCode };
}

test("running from a nested worktree reads the ancestor .ttt instead of throwing ENOENT", async () => {
	const { nested } = makeWorkspace();

	const { stdout, stderr, exitCode } = await runStatus(nested, []);

	assert.equal(exitCode, 0, stderr);
	assert.match(stdout, /MP-1/);
});

test("state written from a nested worktree lands in the ancestor .ttt, not a new one in the worktree", async () => {
	const { ttt, nested } = makeWorkspace();

	const { exitCode, stderr } = await runStatus(nested, [
		"MP-1",
		"--set",
		"in-progress",
	]);
	assert.equal(exitCode, 0, stderr);

	assert.equal(
		existsSync(path.join(nested, ".ttt")),
		false,
		"must not create a second .ttt inside the worktree",
	);
	assert.equal(readStatuses(ttt)["MP-1"], "in-progress");
});
