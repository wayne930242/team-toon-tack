import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("ttt cancel never exits 0 when it fails before reaching Linear", async () => {
	const dir = mkdtempSync(path.join(tmpdir(), "ttt-cancel-test-"));
	writeFileSync(path.join(dir, "config.toon"), "");

	const env = { ...process.env, TOON_DIR: dir };
	delete env.LINEAR_API_KEY;

	const proc = Bun.spawn(
		["bun", path.join(import.meta.dirname, "cancel.ts"), "FAKE-1", "--yes"],
		{ env, stderr: "pipe" },
	);
	const stderr = await new Response(proc.stderr).text();
	await proc.exited;

	assert.notEqual(
		proc.exitCode,
		0,
		"cancel must not report success (exit 0) when it never reached Linear",
	);
	assert.match(stderr, /LINEAR_API_KEY/);
});
