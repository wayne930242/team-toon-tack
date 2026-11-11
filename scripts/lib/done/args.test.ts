import { test } from "bun:test";
import assert from "node:assert/strict";
import { parseArgs } from "./args.js";

test("parseArgs reads --commit and --repo alongside the issue and message", () => {
	assert.deepEqual(
		parseArgs([
			"MP-1",
			"-m",
			"done",
			"--commit",
			"1a2b3c4",
			"--repo",
			"/tmp/app",
		]),
		{
			issueIds: ["MP-1"],
			message: "done",
			fromRemote: false,
			commit: "1a2b3c4",
			repo: "/tmp/app",
		},
	);
});

test("parseArgs leaves commit and repo unset by default", () => {
	const parsed = parseArgs(["MP-1"]);

	assert.equal(parsed.commit, undefined);
	assert.equal(parsed.repo, undefined);
});

test("parseArgs rejects --commit or --repo without a value", () => {
	assert.throws(() => parseArgs(["MP-1", "--commit"]), /--commit requires/);
	assert.throws(
		() => parseArgs(["--repo", "--from-remote"]),
		/--repo requires/,
	);
});

test("parseArgs collects several issue IDs in order, without duplicates", () => {
	const parsed = parseArgs(["MP-2", "MP-1", "-m", "merged", "MP-2", "MP-3"]);
	assert.deepEqual(parsed.issueIds, ["MP-2", "MP-1", "MP-3"]);
	assert.equal(parsed.message, "merged");
});

test("parseArgs drops an ID repeated in another case", () => {
	assert.deepEqual(parseArgs(["MP-1", "mp-1", "MP-2"]).issueIds, [
		"MP-1",
		"MP-2",
	]);
});
