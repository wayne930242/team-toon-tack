import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import {
	type LocalWorkspace,
	makeLocalWorkspace,
	readToonFile,
	runLocal,
} from "./test-support/local-workspace.js";

interface RemoteIssue {
	id: string;
	state: string;
	title: string;
	parent?: string;
	comments?: string[];
	labelIds?: string[];
	priority?: number;
	assigneeId?: string;
	estimate?: number;
	createdAt?: string;
}

interface RemoteState {
	issues: Record<string, RemoteIssue>;
	labels?: { id: string; name: string }[];
	relations?: {
		id: string;
		issueId: string;
		relatedIssueId: string;
		type: string;
	}[];
}

function readRemoteState(ws: LocalWorkspace): RemoteState {
	return JSON.parse(readFileSync(ws.statePath, "utf8"));
}

const MUTATIONS = /Create|Update|Delete/;

/** Run with a Linear key so migrate reaches the fake Linear. */
function migrate(
	ws: LocalWorkspace,
	args: string[],
	env: Record<string, string> = {},
) {
	return runLocal(ws, "migrate.ts", ["--to", "linear", ...args], {
		LINEAR_API_KEY: "test-key",
		...env,
	});
}

/**
 * Board: MP-1 parent (Todo, Bug, urgent, estimate 3), MP-2 its child
 * (In Progress, one comment), MP-3 blocked by MP-2, MP-4 canceled.
 */
async function seededBoard(): Promise<LocalWorkspace> {
	const ws = await makeLocalWorkspace(["--labels", "Bug,Feature"]);
	const steps: [string, string[]][] = [
		[
			"create.ts",
			[
				"-t",
				"Parent",
				"-l",
				"Bug",
				"-p",
				"1",
				"-a",
				"alice",
				"--estimate",
				"3",
				"-s",
				"Todo",
			],
		],
		["create.ts", ["-t", "Child", "--parent", "MP-1", "-s", "In Progress"]],
		["create.ts", ["-t", "Blocked", "-l", "Feature"]],
		["create.ts", ["-t", "Dropped"]],
		["comment.ts", ["MP-2", "-m", "first note\nsecond line"]],
		["edit.ts", ["MP-3", "--blocked-by", "MP-2"]],
		["cancel.ts", ["MP-4", "-y"]],
	];
	for (const [script, args] of steps) {
		const result = await runLocal(ws, script, args);
		if (result.exitCode !== 0) {
			throw new Error(
				`${script} ${args.join(" ")}: ${result.stdout}\n${result.stderr}`,
			);
		}
	}
	return ws;
}

describe("ttt migrate --to linear", () => {
	test("--dry-run plans every issue and sends no mutation", async () => {
		const ws = await seededBoard();

		const result = await migrate(ws, ["--dry-run"]);

		expect(result.exitCode).toBe(0);
		for (const id of ["MP-1", "MP-2", "MP-3", "MP-4"]) {
			expect(result.stdout).toContain(id);
		}
		expect(result.stdout).toContain("Dry run");
		expect(result.requests.filter((r) => MUTATIONS.test(r.name))).toEqual([]);
		expect(Object.keys(readRemoteState(ws).issues)).toEqual([]);
		const config = readToonFile<{ source: { type: string } }>(
			path.join(ws.dir, "config.toon"),
		);
		expect(config.source.type).toBe("local");
	}, 60_000);

	test("creates every issue with its fields, then switches the source", async () => {
		const ws = await seededBoard();

		const result = await migrate(ws, []);

		expect(result.exitCode).toBe(0);
		const remote = readRemoteState(ws);
		const byTitle = Object.fromEntries(
			Object.entries(remote.issues).map(([key, issue]) => [
				issue.title,
				{ key, ...issue },
			]),
		);
		expect(Object.keys(byTitle).sort()).toEqual([
			"Blocked",
			"Child",
			"Dropped",
			"Parent",
		]);
		expect(byTitle.Parent.state).toBe("s-todo");
		expect(byTitle.Parent.priority).toBe(1);
		expect(byTitle.Parent.estimate).toBe(3);
		expect(byTitle.Parent.assigneeId).toBe("u-alice");
		const bug = remote.labels?.find((l) => l.name === "Bug");
		expect(bug).toBeDefined();
		expect(byTitle.Parent.labelIds).toEqual([bug?.id as string]);
		expect(byTitle.Child.state).toBe("s-progress");
		expect(byTitle.Child.parent).toBe(byTitle.Parent.key);
		expect(byTitle.Child.comments?.length).toBe(1);
		expect(byTitle.Child.comments?.[0]).toContain("first note\nsecond line");
		expect(byTitle.Dropped.state).toBe("s-canceled");
		expect(remote.relations).toEqual([
			expect.objectContaining({
				issueId: byTitle.Child.id,
				relatedIssueId: byTitle.Blocked.id,
				type: "blocks",
			}),
		]);

		const mapping = readToonFile<{
			issues: { local: string; identifier: string }[];
		}>(path.join(ws.dir, "local", "migration-linear.toon"));
		expect(mapping.issues.map((e) => e.local)).toEqual([
			"MP-1",
			"MP-2",
			"MP-3",
			"MP-4",
		]);
		expect(mapping.issues[0].identifier).toBe(byTitle.Parent.key);

		const config = readToonFile<{
			source: { type: string };
			teams: Record<string, { id: string }>;
		}>(path.join(ws.dir, "config.toon"));
		expect(config.source.type).toBe("linear");
		expect(Object.values(config.teams).map((t) => t.id)).toEqual(["team-dev"]);
		// The board stays behind as the record of what was migrated
		expect(existsSync(path.join(ws.dir, "local", "board.toon"))).toBe(true);
	}, 60_000);

	test("a failed run keeps the local source and a rerun finishes without duplicates", async () => {
		const ws = await seededBoard();
		const titles = () =>
			Object.values(readRemoteState(ws).issues)
				.map((i) => i.title)
				.sort();
		const sourceType = () =>
			readToonFile<{ source: { type: string } }>(
				path.join(ws.dir, "config.toon"),
			).source.type;

		// Killed after Linear stored "Child", before the run could record it
		const crashed = await migrate(ws, [], {
			MOCK_LINEAR_CRASH_AFTER_CREATE: "Child",
		});
		expect(crashed.exitCode).not.toBe(0);
		expect(sourceType()).toBe("local");
		expect(titles()).toEqual(["Child", "Parent"]);

		// Linear refuses "Dropped": the run stops and says how to go on
		const refused = await migrate(ws, [], {
			MOCK_LINEAR_FAIL_CREATE: "Dropped",
		});
		expect(refused.exitCode).toBe(1);
		expect(refused.stderr).toContain("rerun");
		expect(sourceType()).toBe("local");
		expect(titles()).toEqual(["Blocked", "Child", "Parent"]);
		expect(
			refused.requests.filter((r) => r.name === "createIssue").length,
		).toBe(2);

		const finished = await migrate(ws, []);
		expect(finished.exitCode).toBe(0);
		expect(sourceType()).toBe("linear");
		const remote = readRemoteState(ws);
		expect(titles()).toEqual(["Blocked", "Child", "Dropped", "Parent"]);
		expect(remote.relations?.length).toBe(1);
		const child = Object.values(remote.issues).find((i) => i.title === "Child");
		expect(child?.comments?.length).toBe(1);
		expect(remote.labels?.map((l) => l.name).sort()).toEqual([
			"Bug",
			"Feature",
		]);
		expect(
			finished.requests.filter((r) => r.name === "createIssue").length,
		).toBe(1);

		// Done: a third run creates nothing
		const third = await migrate(ws, []);
		expect(third.exitCode).not.toBe(0);
		expect(third.requests.filter((r) => MUTATIONS.test(r.name))).toEqual([]);
	}, 90_000);

	test("two runs at once: one migrates, the other is refused", async () => {
		const ws = await seededBoard();
		// Both runs sit in their first Linear query, before any mapping exists
		const slow = { MOCK_LINEAR_DELAY: "teams=1500" };

		const runs = await Promise.all([
			migrate(ws, [], slow),
			migrate(ws, [], slow),
		]);

		expect(runs.map((r) => r.exitCode).sort()).toEqual([0, 1]);
		const refused = runs.find((r) => r.exitCode === 1);
		expect(refused?.stderr).toContain("migration.lock");
		expect(refused?.stderr).not.toContain("Nothing is lost");
		expect(refused?.requests.filter((r) => MUTATIONS.test(r.name))).toEqual([]);
		expect(
			Object.values(readRemoteState(ws).issues)
				.map((i) => i.title)
				.sort(),
		).toEqual(["Blocked", "Child", "Dropped", "Parent"]);
	}, 60_000);

	test("a lock left by a live process refuses; one left by a dead process is taken over", async () => {
		const ws = await seededBoard();
		const lock = path.join(ws.dir, "local", "migration.lock");
		const holder = (pid: number) =>
			`${pid}@${hostname()} 2026-11-12T00:00:00.000Z test\n`;

		// This test process is alive
		writeFileSync(lock, holder(process.pid));
		const busy = await migrate(ws, []);
		expect(busy.exitCode).toBe(1);
		expect(busy.stderr).toContain(`${process.pid}@`);
		expect(busy.requests.filter((r) => MUTATIONS.test(r.name))).toEqual([]);
		expect(
			existsSync(path.join(ws.dir, "local", "migration-linear.toon")),
		).toBe(false);

		// A process that has exited
		const dead = spawnSync("true").pid as number;
		writeFileSync(lock, holder(dead));
		const taken = await migrate(ws, []);
		expect(taken.exitCode).toBe(0);
		expect(Object.keys(readRemoteState(ws).issues).length).toBe(4);
		expect(existsSync(lock)).toBe(false);
	}, 60_000);
});
