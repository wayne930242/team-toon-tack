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

test("getLatestCommit({ ref, cwd }) describes that commit of that repo, not HEAD of the process cwd", async () => {
	const { getLatestCommit } = await import("./git.js");
	const repo = makeGitRepo("explicit");

	try {
		const firstHash = execSync("git rev-parse HEAD~1", {
			cwd: repo.dir,
			encoding: "utf-8",
		}).trim();

		// The test process runs from the ttt repo, so cwd must be honoured.
		const commit = getLatestCommit({ ref: firstHash, cwd: repo.dir });

		assert.equal(commit?.fullHash, firstHash);
		assert.equal(commit?.message, "explicit first commit");
		assert.equal(getLatestCommit({ cwd: repo.dir })?.fullHash, repo.headHash);
	} finally {
		rmSync(repo.dir, { recursive: true, force: true });
	}
});

test("getLatestCommit with a ref diffs that commit against its parent only", async () => {
	const { getLatestCommit } = await import("./git.js");
	const repo = makeGitRepo("stat");

	try {
		// A later uncommitted edit must not leak into an older commit's stat.
		writeFileSync(path.join(repo.dir, "other.txt"), "uncommitted\n");
		execSync("git add other.txt", { cwd: repo.dir });

		const commit = getLatestCommit({ ref: repo.headHash, cwd: repo.dir });

		assert.match(commit?.diffStat ?? "", /file\.txt/);
		assert.doesNotMatch(commit?.diffStat ?? "", /other\.txt/);
	} finally {
		rmSync(repo.dir, { recursive: true, force: true });
	}
});

test("getLatestCommit returns null for an unknown ref and keeps a root commit", async () => {
	const { getLatestCommit } = await import("./git.js");
	const repo = makeGitRepo("root");

	try {
		assert.equal(
			getLatestCommit({ ref: "deadbeefnotacommit", cwd: repo.dir }),
			null,
		);

		const rootHash = execSync("git rev-list --max-parents=0 HEAD", {
			cwd: repo.dir,
			encoding: "utf-8",
		}).trim();
		const root = getLatestCommit({ ref: rootHash, cwd: repo.dir });
		assert.equal(root?.fullHash, rootHash);
		assert.equal(root?.diffStat, "");
	} finally {
		rmSync(repo.dir, { recursive: true, force: true });
	}
});
