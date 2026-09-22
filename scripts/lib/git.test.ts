import { test } from "bun:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** A standalone git repo with one commit, independent of the outer repo. */
function makeGitRepo(label: string): { dir: string; headHash: string } {
	const dir = mkdtempSync(path.join(tmpdir(), `ttt-git-${label}-`));
	const run = (cmd: string) =>
		execSync(cmd, { cwd: dir, stdio: ["ignore", "ignore", "ignore"] });

	run("git init -q");
	run('git config user.email "test@example.com"');
	run('git config user.name "Test"');
	writeFileSync(path.join(dir, "file.txt"), `${label}\n`);
	run("git add file.txt");
	run(`git commit -q -m "${label} first commit"`);
	// getLatestCommit() diffs against HEAD~1, so a single-commit repo would
	// make it throw and return null - give it a second commit.
	writeFileSync(path.join(dir, "file.txt"), `${label} v2\n`);
	run("git add file.txt");
	run(`git commit -q -m "${label} commit"`);

	const headHash = execSync("git rev-parse HEAD", {
		cwd: dir,
		encoding: "utf-8",
	}).trim();

	return { dir, headHash };
}

/** Runs a tiny script that imports getLatestCommit() from git.ts and prints
 * its fullHash as JSON, with `cwd` set independently of this test process. */
async function getLatestCommitFrom(cwd: string): Promise<string | null> {
	const proc = Bun.spawn(
		[
			"bun",
			"-e",
			`import("${path.join(import.meta.dirname, "git.ts")}").then(m => {
				const commit = m.getLatestCommit();
				process.stdout.write(JSON.stringify(commit?.fullHash ?? null));
			})`,
		],
		{ cwd, stdout: "pipe", stderr: "pipe" },
	);
	const stdout = await new Response(proc.stdout).text();
	await proc.exited;
	return JSON.parse(stdout);
}

test("getLatestCommit reflects the process cwd, not some other repo", async () => {
	const outer = makeGitRepo("outer");
	const inner = makeGitRepo("inner");

	try {
		const outerResult = await getLatestCommitFrom(outer.dir);
		const innerResult = await getLatestCommitFrom(inner.dir);

		assert.equal(outerResult, outer.headHash);
		assert.equal(innerResult, inner.headHash);
		assert.notEqual(outerResult, innerResult);
	} finally {
		rmSync(outer.dir, { recursive: true, force: true });
		rmSync(inner.dir, { recursive: true, force: true });
	}
});
