import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decode, encode } from "@toon-format/toon";
import { initBoard, listIssues, readIssue, transact } from "./store.js";
import type { LocalIssue } from "./types.js";

let previousDir: string | undefined;
let dir: string;

beforeEach(async () => {
	previousDir = process.env.TOON_DIR;
	dir = mkdtempSync(path.join(tmpdir(), "ttt-local-store-"));
	process.env.TOON_DIR = dir;
	await initBoard({
		version: 1,
		team: { key: "MP", name: "MP" },
		next_number: 1,
		statuses: [
			{ id: "todo", name: "Todo", type: "unstarted" },
			{ id: "done", name: "Done", type: "completed" },
		],
		labels: [],
	});
});

afterEach(() => {
	if (previousDir === undefined) delete process.env.TOON_DIR;
	else process.env.TOON_DIR = previousDir;
});

const fields = (title: string) => ({
	title,
	state: "Todo",
	priority: 0,
	labels: [],
	relations: [],
	comments: [],
});

test("transactions in one process wait for each other's lock", async () => {
	const created = await Promise.all(
		Array.from({ length: 5 }, (_, i) =>
			transact((tx) => tx.create(fields(`T${i}`))),
		),
	);
	expect(created.map((i) => i.number).sort()).toEqual([1, 2, 3, 4, 5]);
	expect((await listIssues()).map((i) => i.identifier)).toEqual([
		"MP-1",
		"MP-2",
		"MP-3",
		"MP-4",
		"MP-5",
	]);
});

test("an issue file above the counter (left by a crash) is never reused", async () => {
	await transact((tx) => tx.create(fields("One")));
	// A crash after writing MP-5 but before the board's counter moved
	const orphan: LocalIssue = {
		...fields("Orphan"),
		identifier: "MP-5",
		number: 5,
		created_at: "2026-11-12T00:00:00.000Z",
		updated_at: "2026-11-12T00:00:00.000Z",
	};
	writeFileSync(path.join(dir, "local", "issues", "MP-5.toon"), encode(orphan));

	const next = await transact((tx) => tx.create(fields("Next")));

	expect(next.identifier).toBe("MP-6");
	const board = decode(
		readFileSync(path.join(dir, "local", "board.toon"), "utf8"),
	) as { next_number: number };
	expect(board.next_number).toBe(7);
});

test("text with newlines, quotes, and colons survives the file", async () => {
	const description = 'Steps:\n- open "login"\n- key: value, more';
	await transact((tx) =>
		tx.create({ ...fields("Text"), description, estimate: 3 }),
	);
	const issue = await readIssue("mp-1");
	expect(issue?.description).toBe(description);
	expect(issue?.estimate).toBe(3);
	expect(await readIssue("1")).toEqual(issue);
});
