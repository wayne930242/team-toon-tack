import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { encode } from "@toon-format/toon";

test("ttt show <id> prints the Status line", async () => {
	const dir = mkdtempSync(path.join(tmpdir(), "ttt-show-test-"));
	writeFileSync(
		path.join(dir, "config.toon"),
		encode({
			source: { type: "trello" },
			teams: { dev: { id: "board-1", name: "Dev" } },
			users: {},
		}),
	);
	writeFileSync(
		path.join(dir, "local.toon"),
		encode({ current_user: "me", team: "dev" }),
	);
	writeFileSync(
		path.join(dir, "cycle.toon"),
		encode({
			cycleId: "c1",
			cycleName: "Cycle 1",
			updatedAt: "2026-09-01T00:00:00.000Z",
			tasks: [
				{
					id: "MP-1",
					linearId: "card-1",
					title: "Task MP-1",
					status: "In Progress",
					localStatus: "in-progress",
					priority: 3,
					labels: [],
				},
			],
		}),
	);

	const proc = Bun.spawn(
		["bun", path.join(import.meta.dirname, "show.ts"), "MP-1"],
		{
			env: { ...process.env, TOON_DIR: dir },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const stdout = await new Response(proc.stdout).text();
	await proc.exited;

	assert.match(stdout, /Status: In Progress \(Local: in-progress\)/);
	assert.match(stdout, /Assignee: Unassigned/);
});
