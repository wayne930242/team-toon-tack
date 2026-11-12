import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { encode } from "@toon-format/toon";
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

	test("a rerun carries local edits made to issues an earlier run created", async () => {
		const ws = await seededBoard();
		const failed = await migrate(ws, [], {
			MOCK_LINEAR_FAIL_CREATE: "Dropped",
		});
		expect(failed.exitCode).toBe(1);

		// Between the runs: edits through ttt, and a parent set by hand
		for (const [script, args] of [
			[
				"edit.ts",
				[
					"MP-1",
					"-t",
					"Parent v2",
					"-l",
					"Feature",
					"--estimate",
					"5",
					"--no-interactive",
				],
			],
			["assign.ts", ["MP-3", "-a", "alice"]],
			["cancel.ts", ["MP-3", "-y"]],
		] as [string, string[]][]) {
			const result = await runLocal(ws, script, args);
			expect(result.exitCode, `${script}: ${result.stderr}`).toBe(0);
		}
		const file = path.join(ws.dir, "local", "issues", "MP-3.toon");
		const blocked = readToonFile<Record<string, unknown>>(file);
		writeFileSync(file, encode({ ...blocked, parent: "MP-1" }));

		const finished = await migrate(ws, []);

		expect(finished.exitCode, finished.stderr).toBe(0);
		const remote = readRemoteState(ws);
		const key = (title: string) =>
			Object.entries(remote.issues).find(([, i]) => i.title === title)?.[0];
		expect(key("Parent"), "the old title is gone").toBeUndefined();
		const parent = remote.issues[key("Parent v2") as string];
		const feature = remote.labels?.find((l) => l.name === "Feature");
		expect(parent.labelIds).toEqual([feature?.id as string]);
		expect(parent.estimate).toBe(5);
		const moved = remote.issues[key("Blocked") as string];
		expect(moved.assigneeId).toBe("u-alice");
		expect(moved.state).toBe("s-canceled");
		expect(moved.parent).toBe(key("Parent v2"));
		// Child was not edited: its only update sets the parent, which the
		// failed run had not reached
		const childId = remote.issues[key("Child") as string].id;
		expect(
			finished.requests
				.filter((r) => r.name === "updateIssue" && r.variables.id === childId)
				.map((r) => Object.keys(r.variables.input as object)),
		).toEqual([["parentId"]]);
	}, 90_000);

	test("a rerun skips a relation whose issue left the board before it was created", async () => {
		const ws = await seededBoard();
		// Linear refuses MP-3, which MP-2 blocks; then MP-3 is removed by hand
		const failed = await migrate(ws, [], {
			MOCK_LINEAR_FAIL_CREATE: "Blocked",
		});
		expect(failed.exitCode).toBe(1);
		rmSync(path.join(ws.dir, "local", "issues", "MP-3.toon"));

		const result = await migrate(ws, []);

		expect(result.exitCode, result.stderr).toBe(0);
		expect(result.stdout).toContain("MP-2 blocks MP-3");
		expect(readRemoteState(ws).relations ?? []).toEqual([]);
		expect(
			Object.values(readRemoteState(ws).issues)
				.map((i) => i.title)
				.sort(),
		).toEqual(["Child", "Dropped", "Parent"]);
	}, 60_000);

	test("a rerun takes a label someone made in Linear after the first run missed it", async () => {
		const ws = await seededBoard();
		const failed = await migrate(ws, [], {
			MOCK_LINEAR_FAIL_CREATE: "Feature",
		});
		expect(failed.exitCode).toBe(1);
		const state = readRemoteState(ws);
		state.labels = [
			...(state.labels ?? []),
			{ id: "by-hand", name: "feature" },
		];
		writeFileSync(ws.statePath, JSON.stringify(state));

		const result = await migrate(ws, []);

		expect(result.exitCode, result.stderr).toBe(0);
		const remote = readRemoteState(ws);
		expect(remote.labels?.map((l) => l.name).sort()).toEqual([
			"Bug",
			"feature",
		]);
		const blocked = Object.values(remote.issues).find(
			(i) => i.title === "Blocked",
		);
		expect(blocked?.labelIds).toEqual(["by-hand"]);
	}, 60_000);

	test("the plan names what Linear sets itself and flags a name two Linear users share", async () => {
		const ws = await seededBoard();
		const twin = { MOCK_LINEAR_DUPLICATE_USER: "Alice" };

		const plan = await migrate(ws, ["--dry-run"], twin);

		expect(plan.exitCode, plan.stderr).toBe(0);
		expect(plan.stdout).toContain("creator");
		expect(plan.stdout).toContain("MP-4"); // canceled_at
		expect(plan.stdout).toMatch(
			/Alice.*alice@example\.com.*alice2@example\.com/,
		);
		const result = await migrate(ws, [], twin);
		expect(result.exitCode, result.stderr).toBe(0);
		const parent = Object.values(readRemoteState(ws).issues).find(
			(i) => i.title === "Parent",
		);
		expect(parent?.assigneeId).toBeUndefined();
	}, 60_000);

	test("an estimate off the team's scale is named in the plan and left out", async () => {
		const ws = await makeLocalWorkspace();
		for (const [title, estimate] of [
			["Fits", "3"],
			["Too big", "8"],
		]) {
			const result = await runLocal(ws, "create.ts", [
				"-t",
				title,
				"--estimate",
				estimate,
			]);
			expect(result.exitCode, result.stderr).toBe(0);
		}
		// Linear scale 1-5
		const scale = { MOCK_LINEAR_ESTIMATION: "linear" };

		const plan = await migrate(ws, ["--dry-run"], scale);
		expect(plan.exitCode, plan.stderr).toBe(0);
		expect(plan.stdout).toContain("MP-2 (8)");
		expect(plan.stdout).not.toContain("MP-1 (3)");

		const result = await migrate(ws, [], scale);
		expect(result.exitCode, result.stderr).toBe(0);
		const byTitle = Object.fromEntries(
			Object.values(readRemoteState(ws).issues).map((i) => [i.title, i]),
		);
		expect(byTitle.Fits.estimate).toBe(3);
		expect(byTitle["Too big"].estimate).toBeUndefined();
		// The board keeps it
		expect(
			readToonFile<{ estimate?: number }>(
				path.join(ws.dir, "local", "issues", "MP-2.toon"),
			).estimate,
		).toBe(8);
	}, 60_000);

	test("open work orders move to the Linear ids, so order commands leave Linear's own MP-1 alone", async () => {
		const ws = await makeLocalWorkspace();
		// The workspace already has issues of its own under the same key
		writeFileSync(
			ws.statePath,
			JSON.stringify({
				issues: {
					"MP-1": { state: "s-review", title: "Someone else's MP-1" },
					"MP-2": { state: "s-review", title: "Someone else's MP-2" },
				},
			}),
		);
		const order = "app/2026-11-12-a";
		const steps: [string, string[]][] = [
			["create.ts", ["-t", "One", "-a", "alice"]],
			["create.ts", ["-t", "Two", "-a", "alice"]],
			["order.ts", ["open", order]],
			["claim.ts", ["MP-1", "MP-2", "--order", order]],
			["order.ts", ["review", order, "MP-1", "MP-2"]],
		];
		for (const [script, args] of steps) {
			const result = await runLocal(ws, script, args);
			expect(result.exitCode, `${script}: ${result.stderr}`).toBe(0);
		}

		const result = await migrate(ws, []);
		expect(result.exitCode, result.stderr).toBe(0);

		const mapping = readToonFile<{
			issues: { local: string; identifier: string }[];
		}>(path.join(ws.dir, "local", "migration-linear.toon"));
		const linearId = (local: string) =>
			mapping.issues.find((e) => e.local === local)?.identifier as string;
		const orderFile = path.join(ws.dir, "orders", "app", "2026-11-12-a.toon");
		const stored = readToonFile<{
			tickets: { id: string }[];
			log: { event: string }[];
		}>(orderFile);
		expect(stored.tickets.map((t) => t.id)).toEqual([
			linearId("MP-1"),
			linearId("MP-2"),
		]);
		expect(stored.log.at(-1)?.event).toContain(`MP-1 → ${linearId("MP-1")}`);

		// The integrator closes the batch, now against Linear
		const linear = { LINEAR_API_KEY: "test-key" };
		for (const args of [
			["seal", order, "--gated-head", "abc1234"],
			["close", order, "--merged", "def5678"],
		]) {
			const run = await runLocal(ws, "order.ts", args, linear);
			expect(run.exitCode, `${run.stdout}\n${run.stderr}`).toBe(0);
		}

		const remote = readRemoteState(ws);
		for (const id of ["MP-1", "MP-2"]) {
			expect(remote.issues[id].state).toBe("s-review");
			expect(remote.issues[id].comments ?? []).toEqual([]);
			const migrated = remote.issues[linearId(id)];
			expect(migrated.state).toBe("s-done");
			expect(migrated.comments?.at(-1)).toContain(
				`**Work order:** \`${order}\``,
			);
		}
	}, 90_000);

	test("an order still working a ticket that is not on the board refuses the migration", async () => {
		const ws = await makeLocalWorkspace();
		for (const [script, args] of [
			["create.ts", ["-t", "One", "-a", "alice"]],
			["create.ts", ["-t", "Two", "-a", "alice"]],
			["claim.ts", ["MP-1", "MP-2", "--order", "auto", "--project", "app"]],
		] as [string, string[]][]) {
			const result = await runLocal(ws, script, args);
			expect(result.exitCode, `${script}: ${result.stderr}`).toBe(0);
		}
		const [order] = readdirSync(path.join(ws.dir, "orders", "app"))
			.filter((f) => f.endsWith(".toon"))
			.map((f) => `app/${f.slice(0, -".toon".length)}`);
		// Removed by hand from the board
		rmSync(path.join(ws.dir, "local", "issues", "MP-2.toon"));

		for (const args of [["--dry-run"], []]) {
			const result = await migrate(ws, args);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(`MP-2 (${order})`);
			expect(result.requests.filter((r) => MUTATIONS.test(r.name))).toEqual([]);
		}
	}, 60_000);

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
