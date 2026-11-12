/**
 * Test fixture: a temp project whose `.ttt` uses the local source. It shares
 * the shape of `LinearWorkspace`, so `runCli` drives it, and it comes with an
 * empty fake Linear (see `linear-mock.ts`) that `ttt migrate` can target.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decode } from "@toon-format/toon";
import {
	type CliResult,
	type LinearWorkspace,
	runCli,
} from "./linear-workspace.js";

export interface LocalWorkspace extends LinearWorkspace {
	/** The project directory that holds `.ttt` (cwd of every run) */
	project: string;
}

/** An empty project: no `.ttt` yet. Init it with `initLocal`. */
export function makeLocalProject(): LocalWorkspace {
	const project = mkdtempSync(path.join(tmpdir(), "ttt-local-test-"));
	const dir = path.join(project, ".ttt");
	mkdirSync(dir);
	const statePath = path.join(project, "mock-linear.json");
	const logPath = path.join(project, "requests.jsonl");
	writeFileSync(statePath, JSON.stringify({ issues: {} }));
	writeFileSync(logPath, "");
	return { project, dir, statePath, logPath };
}

/** Run a CLI script in the project, without any Linear key. */
export function runLocal(
	workspace: LocalWorkspace,
	script: string,
	args: string[],
	env: Record<string, string> = {},
): Promise<CliResult> {
	return runCli(
		workspace,
		script,
		args,
		{ LINEAR_API_KEY: "", ...env },
		undefined,
		workspace.project,
	);
}

/** A project initialised as `ttt init --source local --team MP -y`. */
export async function makeLocalWorkspace(
	initArgs: string[] = [],
): Promise<LocalWorkspace> {
	const workspace = makeLocalProject();
	const result = await runLocal(workspace, "init.ts", [
		"--source",
		"local",
		"--team",
		"MP",
		"--user",
		"Alice",
		"-y",
		...initArgs,
	]);
	if (result.exitCode !== 0) {
		throw new Error(`init failed: ${result.stdout}\n${result.stderr}`);
	}
	return workspace;
}

export function readToonFile<T = Record<string, unknown>>(file: string): T {
	return decode(readFileSync(file, "utf8"), { strict: false }) as T;
}

export function readLocalIssue<T = Record<string, unknown>>(
	workspace: LocalWorkspace,
	identifier: string,
): T {
	return readToonFile<T>(
		path.join(workspace.dir, "local", "issues", `${identifier}.toon`),
	);
}

export function readBoardFile<T = Record<string, unknown>>(
	workspace: LocalWorkspace,
): T {
	return readToonFile<T>(path.join(workspace.dir, "local", "board.toon"));
}
