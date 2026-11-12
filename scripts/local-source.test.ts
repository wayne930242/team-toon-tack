import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type { CliResult } from "./test-support/linear-workspace.js";
import {
	type LocalWorkspace,
	makeLocalProject,
	makeLocalWorkspace,
	readBoardFile,
	readLocalIssue,
	readToonFile,
	runLocal,
} from "./test-support/local-workspace.js";

interface StoredIssue {
	identifier: string;
	title: string;
	state: string;
	priority: number;
	labels: string[];
	assignee?: string;
	estimate?: number;
	parent?: string;
	relations: { type: string; issue: string }[];
	comments: { body: string; user?: string }[];
	creator?: string;
	created_at: string;
	updated_at: string;
	completed_at?: string;
	canceled_at?: string;
}

interface StoredTask {
	id: string;
	status: string;
	localStatus: string;
	assignee?: string;
	estimate?: { hours: number };
}

function ok(result: CliResult): CliResult {
	if (result.exitCode !== 0) {
		throw new Error(
			`exit ${result.exitCode}\n${result.stdout}\n${result.stderr}`,
		);
	}
	return result;
}

function issue(ws: LocalWorkspace, id: string): StoredIssue {
	return readLocalIssue<StoredIssue>(ws, id);
}

function cycleTasks(ws: LocalWorkspace): StoredTask[] {
	return readToonFile<{ tasks: StoredTask[] }>(path.join(ws.dir, "cycle.toon"))
		.tasks;
}

function cycleTask(ws: LocalWorkspace, id: string): StoredTask | undefined {
	return cycleTasks(ws).find((t) => t.id === id);
}

function issueFiles(ws: LocalWorkspace): string[] {
	return readdirSync(path.join(ws.dir, "local", "issues"))
		.filter((f) => f.endsWith(".toon"))
		.sort();
}

describe("ttt init --source local", () => {
	test("flags set the team key, user, statuses, and labels; no API key needed", async () => {
		const ws = makeLocalProject();

		const result = ok(
			await runLocal(ws, "init.ts", [
				"--source",
				"local",
				"--team",
				"web",
				"--user",
				"Alice Chen",
				"--email",
				"alice@example.com",
				"--members",
				"Bob",
				"--statuses",
				"Todo,Doing,Review:started,Shipped:completed,Dropped",
				"--labels",
				"Bug,Feature",
				"-y",
			]),
		);
		expect(result.stdout).toContain("Local");

		const config = readToonFile<{
			source: { type: string };
			teams: Record<string, { id: string; name: string }>;
			users: Record<string, { id: string; email: string; displayName: string }>;
			labels: Record<string, { name: string }>;
			status_transitions: Record<string, unknown>;
		}>(path.join(ws.dir, "config.toon"));
		expect(config.source.type).toBe("local");
		expect(config.teams.web).toEqual({ id: "WEB", name: "WEB" });
		expect(config.users.alice_chen).toEqual({
			id: "alice_chen",
			email: "alice@example.com",
			displayName: "Alice Chen",
		});
		expect(config.users.bob.email).toBe("bob@local");
		expect(Object.values(config.labels).map((l) => l.name)).toEqual([
			"Bug",
			"Feature",
		]);
		expect(config.status_transitions).toEqual({
			todo: "Todo",
			in_progress: "Doing",
			done: "Shipped",
			testing: "Review",
		});

		const local = readToonFile<Record<string, unknown>>(
			path.join(ws.dir, "local.toon"),
		);
		expect(local).toMatchObject({
			current_user: "alice_chen",
			team: "web",
			status_source: "remote",
			completion_mode: "simple",
		});

		const board = readBoardFile<{
			team: { key: string };
			next_number: number;
			statuses: { name: string; type: string }[];
		}>(ws);
		expect(board.team.key).toBe("WEB");
		expect(board.next_number).toBe(1);
		expect(board.statuses.map((s) => `${s.name}:${s.type}`)).toEqual([
			"Todo:unstarted",
			"Doing:started",
			"Review:started",
			"Shipped:completed",
			"Dropped:canceled",
		]);
		expect(
			readToonFile<{ tasks: unknown[] }>(path.join(ws.dir, "cycle.toon")).tasks,
		).toEqual([]);
	}, 30_000);

	test("-y alone uses Linear's default statuses and a key from the directory", async () => {
		const ws = makeLocalProject();

		ok(await runLocal(ws, "init.ts", ["--source", "local", "-y"]));

		const board = readBoardFile<{
			team: { key: string };
			statuses: { name: string; type: string }[];
		}>(ws);
		expect(board.team.key).toMatch(/^[A-Z][A-Z0-9]*$/);
		expect(board.statuses.map((s) => s.name)).toEqual([
			"Backlog",
			"Todo",
			"In Progress",
			"In Review",
			"Done",
			"Canceled",
		]);
		const config = readToonFile<{
			status_transitions: Record<string, unknown>;
		}>(path.join(ws.dir, "config.toon"));
		expect(config.status_transitions).toEqual({
			todo: "Todo",
			in_progress: "In Progress",
			done: "Done",
			testing: "In Review",
		});
	}, 30_000);

	test("a bad team key or status type is refused", async () => {
		const ws = makeLocalProject();
		const badKey = await runLocal(ws, "init.ts", [
			"--source",
			"local",
			"--team",
			"1x",
			"-y",
		]);
		expect(badKey.exitCode).not.toBe(0);
		expect(badKey.stderr).toContain("team key");

		const badType = await runLocal(ws, "init.ts", [
			"--source",
			"local",
			"--team",
			"MP",
			"--statuses",
			"Todo:wip",
			"-y",
		]);
		expect(badType.exitCode).not.toBe(0);
		expect(badType.stderr).toContain("wip");
	}, 30_000);

	test("init --force keeps the board's issues and numbering", async () => {
		const ws = await makeLocalWorkspace();
		ok(await runLocal(ws, "create.ts", ["-t", "Keep me"]));

		ok(
			await runLocal(ws, "init.ts", [
				"--source",
				"local",
				"--team",
				"MP",
				"--labels",
				"Later",
				"-y",
				"--force",
			]),
		);

		expect(issue(ws, "MP-1").title).toBe("Keep me");
		const board = readBoardFile<{
			next_number: number;
			labels: { name: string }[];
		}>(ws);
		expect(board.next_number).toBe(2);
		expect(board.labels.map((l) => l.name)).toContain("Later");

		const otherKey = await runLocal(ws, "init.ts", [
			"--source",
			"local",
			"--team",
			"XY",
			"-y",
			"--force",
		]);
		expect(otherKey.exitCode).not.toBe(0);
		expect(otherKey.stderr).toContain("MP");
	}, 30_000);
});

describe("local issue numbers", () => {
	test("concurrent creates get distinct numbers and the counter only grows", async () => {
		const ws = await makeLocalWorkspace();

		const runs = await Promise.all(
			Array.from({ length: 8 }, (_, i) =>
				runLocal(ws, "create.ts", ["-t", `Parallel ${i}`]),
			),
		);
		for (const run of runs) ok(run);

		expect(issueFiles(ws)).toEqual(
			Array.from({ length: 8 }, (_, i) => `MP-${i + 1}.toon`).sort(),
		);
		const titles = issueFiles(ws).map(
			(f) => issue(ws, f.replace(".toon", "")).title,
		);
		expect(new Set(titles).size).toBe(8);
		expect(readBoardFile<{ next_number: number }>(ws).next_number).toBe(9);

		// A removed issue's number is not handed out again
		ok(await runLocal(ws, "create.ts", ["-t", "Ninth"]));
		rmSync(path.join(ws.dir, "local", "issues", "MP-9.toon"));
		const tenth = ok(await runLocal(ws, "create.ts", ["-t", "Tenth"]));
		expect(tenth.stdout).toContain("MP-10");
	}, 60_000);
});

describe("commands on the local source", () => {
	test("create, show, edit, assign, comment, status, cancel, estimate", async () => {
		const ws = await makeLocalWorkspace([
			"--members",
			"Bob",
			"--labels",
			"Bug,Feature",
		]);

		const created = ok(
			await runLocal(ws, "create.ts", [
				"-t",
				"Fix login",
				"-d",
				"Steps:\n1. open",
				"-p",
				"2",
				"-l",
				"Bug",
				"-a",
				"alice",
				"--estimate",
				"2",
			]),
		);
		expect(created.stdout).toContain("Created MP-1");
		const stored = issue(ws, "MP-1");
		expect(stored).toMatchObject({
			identifier: "MP-1",
			title: "Fix login",
			state: "Todo",
			priority: 2,
			labels: ["Bug"],
			assignee: "alice",
			estimate: 2,
			creator: "alice",
		});
		expect(cycleTask(ws, "MP-1")).toMatchObject({
			status: "Todo",
			localStatus: "pending",
			assignee: "alice@local",
		});

		ok(await runLocal(ws, "create.ts", ["-t", "Sub task", "--parent", "MP-1"]));
		expect(issue(ws, "MP-2").parent).toBe("MP-1");

		const shown = ok(await runLocal(ws, "show.ts", ["MP-1"]));
		expect(shown.stdout).toContain("Fix login");
		expect(shown.stdout).toContain("Steps:");

		const byLabel = ok(await runLocal(ws, "show.ts", ["--label", "bug"]));
		expect(byLabel.stdout).toContain("MP-1");
		expect(byLabel.stdout).not.toContain("MP-2");

		const remoteByStatus = ok(
			await runLocal(ws, "show.ts", ["--remote", "--status", "todo"]),
		);
		expect(remoteByStatus.stdout).toContain("MP-1");
		expect(remoteByStatus.stdout).not.toContain("MP-2");
		const unassigned = ok(
			await runLocal(ws, "show.ts", ["--remote", "--user", "unassigned"]),
		);
		expect(unassigned.stdout).toContain("MP-2");
		expect(unassigned.stdout).not.toContain("MP-1:");

		ok(
			await runLocal(ws, "edit.ts", [
				"MP-1",
				"-t",
				"Fix login flow",
				"-p",
				"1",
				"-l",
				"Feature",
				"--estimate",
				"5",
				"--blocks",
				"MP-2",
			]),
		);
		expect(issue(ws, "MP-1")).toMatchObject({
			title: "Fix login flow",
			priority: 1,
			labels: ["Feature"],
			estimate: 5,
			relations: [{ type: "blocks", issue: "MP-2" }],
		});
		expect(issue(ws, "MP-2").relations).toEqual([
			{ type: "blocked_by", issue: "MP-1" },
		]);

		ok(await runLocal(ws, "assign.ts", ["MP-2", "-a", "bob"]));
		expect(issue(ws, "MP-2").assignee).toBe("bob");

		ok(await runLocal(ws, "comment.ts", ["MP-1", "-m", "Looked at it"]));
		expect(issue(ws, "MP-1").comments).toEqual([
			expect.objectContaining({ body: "Looked at it", user: "Alice" }),
		]);

		ok(await runLocal(ws, "status.ts", ["MP-1", "--set", "in-progress"]));
		expect(issue(ws, "MP-1").state).toBe("In Progress");
		expect(cycleTask(ws, "MP-1")?.localStatus).toBe("in-progress");

		ok(await runLocal(ws, "estimate.ts", ["MP-1", "6"]));
		expect(cycleTask(ws, "MP-1")?.estimate?.hours).toBe(6);

		ok(await runLocal(ws, "cancel.ts", ["MP-2", "--yes"]));
		expect(issue(ws, "MP-2").state).toBe("Canceled");
		expect(issue(ws, "MP-2").canceled_at).toBeDefined();

		const unknown = await runLocal(ws, "show.ts", ["MP-99", "--remote"]);
		expect(unknown.exitCode).not.toBe(0);
	}, 90_000);

	test("claim and done move board states, done takes several ids", async () => {
		const ws = await makeLocalWorkspace();
		for (const [title, priority] of [
			["Low one", "4"],
			["Urgent one", "1"],
			["Medium one", "3"],
		]) {
			ok(
				await runLocal(ws, "create.ts", [
					"-t",
					title,
					"-p",
					priority,
					"-a",
					"alice",
				]),
			);
		}

		const next = ok(await runLocal(ws, "claim.ts", ["next"]));
		expect(next.stdout).toContain("MP-2");
		expect(issue(ws, "MP-2").state).toBe("In Progress");

		ok(await runLocal(ws, "claim.ts", ["MP-1", "MP-3"]));
		expect(issue(ws, "MP-1").state).toBe("In Progress");
		expect(issue(ws, "MP-3").state).toBe("In Progress");

		const done = ok(
			await runLocal(ws, "done-job.ts", ["MP-1", "MP-2", "-m", "Shipped it"]),
		);
		expect(done.stdout).toContain("MP-1");
		for (const id of ["MP-1", "MP-2"]) {
			expect(issue(ws, id).state).toBe("Done");
			expect(issue(ws, id).completed_at).toBeDefined();
			expect(cycleTask(ws, id)?.localStatus).toBe("completed");
		}
		expect(issue(ws, "MP-3").state).toBe("In Progress");

		// A ticket created elsewhere (not in cycle.toon) is claimed from the board
		const cycle = path.join(ws.dir, "cycle.toon");
		const before = readFileSync(cycle, "utf8");
		ok(await runLocal(ws, "create.ts", ["-t", "Fourth"]));
		const { writeFileSync } = await import("node:fs");
		writeFileSync(cycle, before);
		ok(await runLocal(ws, "claim.ts", ["MP-4"]));
		expect(cycleTask(ws, "MP-4")?.localStatus).toBe("in-progress");
	}, 90_000);

	test("sync is a no-op that says why", async () => {
		const ws = await makeLocalWorkspace();
		ok(await runLocal(ws, "create.ts", ["-t", "Stay"]));
		const before = readFileSync(path.join(ws.dir, "cycle.toon"), "utf8");

		const result = ok(await runLocal(ws, "sync.ts", []));

		expect(result.stdout).toContain("local");
		expect(result.stdout).toContain("nothing to sync");
		expect(readFileSync(path.join(ws.dir, "cycle.toon"), "utf8")).toBe(before);
	}, 30_000);

	test("work orders: claim --order, review, rework, return, close", async () => {
		const ws = await makeLocalWorkspace();
		for (const title of ["One", "Two", "Three"]) {
			ok(await runLocal(ws, "create.ts", ["-t", title, "-a", "alice"]));
		}
		const order = "app/2026-11-12-a";
		ok(await runLocal(ws, "order.ts", ["open", order]));

		ok(
			await runLocal(ws, "claim.ts", [
				"MP-1",
				"MP-2",
				"MP-3",
				"--order",
				order,
			]),
		);
		ok(
			await runLocal(ws, "order.ts", ["review", order, "MP-1", "MP-2", "MP-3"]),
		);
		for (const id of ["MP-1", "MP-2", "MP-3"]) {
			expect(issue(ws, id).state).toBe("In Review");
		}

		ok(
			await runLocal(ws, "order.ts", [
				"rework",
				order,
				"MP-3",
				"--reason",
				"gate red",
			]),
		);
		expect(issue(ws, "MP-3").state).toBe("In Progress");
		ok(await runLocal(ws, "order.ts", ["review", order, "MP-3"]));

		ok(
			await runLocal(ws, "order.ts", [
				"return",
				order,
				"MP-2",
				"--reason",
				"waits for MP-9",
			]),
		);
		expect(issue(ws, "MP-2").state).toBe("In Progress");

		ok(
			await runLocal(ws, "order.ts", [
				"seal",
				order,
				"--gated-head",
				"abc1234",
			]),
		);
		const closed = ok(
			await runLocal(ws, "order.ts", ["close", order, "--merged", "def5678"]),
		);
		expect(closed.stdout).toContain("MP-1");
		for (const id of ["MP-1", "MP-3"]) {
			expect(issue(ws, id).state).toBe("Done");
			expect(issue(ws, id).comments.at(-1)?.body).toContain(
				`**Work order:** \`${order}\``,
			);
		}
		expect(issue(ws, "MP-2").state).toBe("In Progress");
	}, 120_000);
});
