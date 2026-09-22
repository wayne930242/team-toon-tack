import { afterEach, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findAncestorWithTtt, findTaskByIssueId, type Task } from "./utils.js";

function task(id: string): Task {
	return {
		id,
		linearId: `uuid-${id}`,
		title: `Task ${id}`,
		status: "Todo",
		localStatus: "pending",
		priority: 0,
		labels: [],
	};
}

test("findTaskByIssueId matches a full ID for any team prefix", () => {
	const tasks = [task("MP-624"), task("QA-77"), task("INFRA-5")];

	assert.equal(findTaskByIssueId(tasks, "QA-77")?.id, "QA-77");
	assert.equal(findTaskByIssueId(tasks, "INFRA-5")?.id, "INFRA-5");
});

test("findTaskByIssueId resolves a bare number without assuming the MP prefix", () => {
	const tasks = [task("QA-77"), task("INFRA-5")];

	assert.equal(findTaskByIssueId(tasks, "77")?.id, "QA-77");
	assert.equal(findTaskByIssueId(tasks, "5")?.id, "INFRA-5");
});

test("findTaskByIssueId refuses to guess when a bare number spans teams", () => {
	const tasks = [task("MP-1"), task("QA-1")];

	assert.equal(findTaskByIssueId(tasks, "1"), undefined);
});

test("findTaskByIssueId returns undefined for an unknown ID", () => {
	const tasks = [task("MP-624")];

	assert.equal(findTaskByIssueId(tasks, "MP-999"), undefined);
	assert.equal(findTaskByIssueId(tasks, "999"), undefined);
});

const cleanupDirs: string[] = [];
let originalHome: string | undefined;

afterEach(() => {
	if (originalHome !== undefined) {
		process.env.HOME = originalHome;
		originalHome = undefined;
	}
	for (const dir of cleanupDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

/** os.homedir() reads $HOME on POSIX, so pointing it at a temp dir makes the
 * ancestor-search boundary deterministic instead of depending on the real
 * machine's home directory contents. */
function useHome(home: string): void {
	originalHome = process.env.HOME;
	process.env.HOME = home;
}

function mkTmp(prefix: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), prefix));
	cleanupDirs.push(dir);
	return dir;
}

test("findAncestorWithTtt finds a .ttt directory several levels up", () => {
	const home = mkTmp("ttt-home-");
	useHome(home);
	const root = path.join(home, "monorepo");
	mkdirSync(path.join(root, ".ttt"), { recursive: true });
	const nested = path.join(root, "apps", "worktree-a", "src");
	mkdirSync(nested, { recursive: true });

	const found = findAncestorWithTtt(nested);
	assert.equal(found.dir, root);
});

test("findAncestorWithTtt matches a .ttt directory at $HOME itself", () => {
	const home = mkTmp("ttt-home-");
	useHome(home);
	mkdirSync(path.join(home, ".ttt"), { recursive: true });
	const nested = path.join(home, "projects", "x");
	mkdirSync(nested, { recursive: true });

	const found = findAncestorWithTtt(nested);
	assert.equal(found.dir, home);
});

test("findAncestorWithTtt stops at $HOME and does not search above it", () => {
	const home = mkTmp("ttt-home-");
	useHome(home);
	const nested = path.join(home, "projects", "x", "y");
	mkdirSync(nested, { recursive: true });

	const found = findAncestorWithTtt(nested);
	assert.equal(found.dir, null);
	if (found.dir === null) {
		assert.equal(found.search.from, nested);
		assert.equal(found.search.to, home);
	}
});

test("findAncestorWithTtt stops at the filesystem root when cwd is outside $HOME", () => {
	// Point $HOME somewhere unrelated so it is never encountered walking up
	// from `deeper`, forcing the walk all the way to the real filesystem root.
	useHome(mkTmp("ttt-unrelated-home-"));
	const nested = mkTmp("ttt-outside-");
	const deeper = path.join(nested, "a", "b");
	mkdirSync(deeper, { recursive: true });

	const found = findAncestorWithTtt(deeper);
	assert.equal(found.dir, null);
	if (found.dir === null) {
		assert.equal(found.search.to, path.parse(deeper).root);
	}
});
