/**
 * Test fixture: a temp `.ttt` directory wired to the fake Linear in
 * `linear-mock.ts`, and a runner for CLI scripts against it. Nothing here
 * reaches a real Linear workspace.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decode, encode } from "@toon-format/toon";

const scriptsDir = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

export interface MockIssueSeed {
	/** Workflow state id in the fake: s-todo, s-progress, s-review, s-done, s-canceled */
	state: string;
	parent?: string;
	comments?: string[];
}

export interface LinearWorkspace {
	/** The `.ttt` directory (TOON_DIR) */
	dir: string;
	statePath: string;
	logPath: string;
}

export interface CliResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	/** GraphQL operations the run sent to the fake Linear */
	requests: { name: string; variables: Record<string, unknown> }[];
}

const STATE_NAMES: Record<string, string> = {
	"s-backlog": "Backlog",
	"s-todo": "Todo",
	"s-progress": "In Progress",
	"s-review": "In Review",
	"s-code-review": "Code Review",
	"s-done": "Done",
	"s-canceled": "Canceled",
};

const LOCAL_STATUS: Record<string, string> = {
	"s-progress": "in-progress",
	"s-review": "in-review",
	"s-code-review": "in-review",
	"s-done": "completed",
};

/**
 * Build a workspace whose remote tickets are `issues`. `localIds` picks the
 * tickets that also sit in cycle.toon (default: all of them).
 */
export function makeLinearWorkspace(
	issues: Record<string, MockIssueSeed>,
	options: {
		localIds?: string[];
		localConfig?: Record<string, unknown>;
		/** Another machine's workspace on the same fake Linear */
		sameRemoteAs?: LinearWorkspace;
	} = {},
): LinearWorkspace {
	const dir = mkdtempSync(path.join(tmpdir(), "ttt-linear-test-"));
	const statePath =
		options.sameRemoteAs?.statePath ?? path.join(dir, "mock-linear.json");
	const logPath = path.join(dir, "requests.jsonl");

	if (!options.sameRemoteAs) {
		writeFileSync(statePath, JSON.stringify({ issues }));
	}
	writeFileSync(logPath, "");
	writeFileSync(
		path.join(dir, "config.toon"),
		encode({
			teams: { dev: { id: "team-dev", name: "Dev" } },
			users: { me: { id: "u1", email: "me@example.com", displayName: "Me" } },
			status_transitions: {
				todo: "Todo",
				in_progress: "In Progress",
				done: "Done",
				testing: "In Review",
			},
		}),
	);
	writeFileSync(
		path.join(dir, "local.toon"),
		encode({
			current_user: "me",
			team: "dev",
			status_source: "remote",
			completion_mode: "simple",
			...options.localConfig,
		}),
	);
	const localIds = options.localIds ?? Object.keys(issues);
	writeFileSync(
		path.join(dir, "cycle.toon"),
		encode({
			cycleId: "c1",
			cycleName: "Cycle 1",
			updatedAt: "2026-09-01T00:00:00.000Z",
			tasks: localIds.map((id) => ({
				id,
				linearId: `uuid-${id}`,
				sourceId: `uuid-${id}`,
				sourceType: "linear",
				title: `Task ${id}`,
				status: STATE_NAMES[issues[id].state],
				localStatus: LOCAL_STATUS[issues[id].state] ?? "pending",
				assignee: "me@example.com",
				priority: 3,
				labels: [],
			})),
		}),
	);

	return { dir, statePath, logPath };
}

/**
 * Run one CLI script (e.g. "done-job.ts") against the workspace. `stdin` is
 * piped to the script when given.
 */
export function runCli(
	workspace: LinearWorkspace,
	script: string,
	args: string[],
	env: Record<string, string> = {},
	stdin?: string,
): Promise<CliResult> {
	const logStart = readFileSync(workspace.logPath, "utf8").length;
	const child = spawn(
		"bun",
		[
			"--preload",
			path.join(scriptsDir, "test-support/linear-mock.ts"),
			path.join(scriptsDir, script),
			...args,
		],
		{
			env: {
				...process.env,
				TOON_DIR: workspace.dir,
				LINEAR_API_KEY: "test-key",
				MOCK_LINEAR_STATE: workspace.statePath,
				MOCK_LINEAR_LOG: workspace.logPath,
				TTT_ACTOR: "tester@box",
				// `bun test` runs in UTC whatever the machine's zone is; the CLI
				// must name dates (order codes) in the zone the test computes them in
				TZ: Intl.DateTimeFormat().resolvedOptions().timeZone,
				...env,
			},
			stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
		},
	);
	child.stdin?.end(stdin);

	let stdout = "";
	let stderr = "";
	child.stdout?.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr?.on("data", (chunk) => {
		stderr += chunk;
	});

	return new Promise((resolve, reject) => {
		child.on("error", reject);
		child.on("close", (exitCode) => {
			const requests = readFileSync(workspace.logPath, "utf8")
				.slice(logStart)
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line));
			resolve({ stdout, stderr, exitCode, requests });
		});
	});
}

/** Remote state of every ticket in the fake: status name and comments. */
export function readRemote(
	workspace: LinearWorkspace,
): Record<string, { status: string; comments: string[] }> {
	const state = JSON.parse(readFileSync(workspace.statePath, "utf8")) as {
		issues: Record<string, MockIssueSeed>;
	};
	return Object.fromEntries(
		Object.entries(state.issues).map(([id, issue]) => [
			id,
			{ status: STATE_NAMES[issue.state], comments: issue.comments ?? [] },
		]),
	);
}

/** localStatus of every ticket in cycle.toon. */
export function readLocalStatuses(
	workspace: LinearWorkspace,
): Record<string, string> {
	const stored = decode(
		readFileSync(path.join(workspace.dir, "cycle.toon"), "utf8"),
		{ strict: false },
	) as unknown as { tasks: { id: string; localStatus: string }[] };
	return Object.fromEntries(stored.tasks.map((t) => [t.id, t.localStatus]));
}
