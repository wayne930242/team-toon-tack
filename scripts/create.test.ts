import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { decode, encode } from "@toon-format/toon";
import "./lib/adapters/trello-adapter.cases.js";

test("non-interactive Trello create adds the one real card to cycle data", async () => {
	const toonDir = await fs.mkdtemp(path.join(os.tmpdir(), "ttt-create-test-"));
	const originalFetch = globalThis.fetch;
	const originalToonDir = process.env.TOON_DIR;
	const originalApiKey = process.env.TRELLO_API_KEY;
	const originalToken = process.env.TRELLO_TOKEN;
	let cardPostCount = 0;

	process.env.TOON_DIR = toonDir;
	process.env.TRELLO_API_KEY = "test-key";
	process.env.TRELLO_TOKEN = "test-token";

	await Promise.all([
		fs.writeFile(
			path.join(toonDir, "config.toon"),
			encode({
				source: { type: "trello" },
				teams: { mosahill: { id: "board-1", name: "Mosahill" } },
				users: {
					wayne: {
						id: "member-1",
						email: "",
						displayName: "Wayne",
					},
				},
				labels: {
					governance: {
						id: "label-governance",
						name: "Governance",
						color: "blue",
					},
				},
				status_transitions: {
					todo: "Proposed",
					in_progress: "In Progress",
					done: "Done",
				},
			}),
		),
		fs.writeFile(
			path.join(toonDir, "local.toon"),
			encode({ current_user: "wayne", team: "mosahill" }),
		),
		fs.writeFile(
			path.join(toonDir, "cycle.toon"),
			encode({
				cycleId: "trello-board-1",
				cycleName: "Mosahill",
				updatedAt: "2026-09-01T00:00:00.000Z",
				tasks: [],
			}),
		),
	]);

	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));
		if (url.pathname === "/1/boards/board-1/lists") {
			return Response.json([
				{
					id: "list-proposed",
					name: "Proposed",
					closed: false,
					pos: 1,
					idBoard: "board-1",
				},
			]);
		}
		if (url.pathname === "/1/boards/board-1/labels") {
			return Response.json([
				{
					id: "label-governance",
					idBoard: "board-1",
					name: "Governance",
					color: "blue",
				},
			]);
		}
		if (url.pathname === "/1/cards" && init?.method === "POST") {
			cardPostCount += 1;
			assert.deepEqual(JSON.parse(String(init.body)), {
				name: "Create governance ticket",
				idList: "list-proposed",
				desc: "Created through ttt",
				idMembers: ["member-1"],
				idLabels: ["label-governance"],
			});
			return Response.json({
				id: "real-card-id",
				name: "Create governance ticket",
				desc: "Created through ttt",
				url: "https://trello.com/c/REALCARD/create-governance-ticket",
				shortUrl: "https://trello.com/c/REALCARD",
				shortLink: "REALCARD",
				closed: false,
				pos: 1,
				due: null,
				dueComplete: false,
				idBoard: "board-1",
				idList: "list-proposed",
				idMembers: ["member-1"],
				idLabels: ["label-governance"],
				labels: [
					{
						id: "label-governance",
						idBoard: "board-1",
						name: "Governance",
						color: "blue",
					},
				],
				badges: {
					attachments: 0,
					comments: 0,
					checkItems: 0,
					checkItemsChecked: 0,
					description: true,
				},
				dateLastActivity: "2026-09-02T08:00:00.000Z",
			});
		}

		throw new Error(
			`Unexpected request: ${init?.method ?? "GET"} ${url.pathname}`,
		);
	};

	try {
		const { create } = await import(`./create.js?test=${Date.now()}`);
		await create([
			"--no-interactive",
			"-t",
			"Create governance ticket",
			"-d",
			"Created through ttt",
			"-a",
			"wayne",
			"-l",
			"governance",
		]);

		assert.equal(cardPostCount, 1);
		const stored = decode(
			await fs.readFile(path.join(toonDir, "cycle.toon"), "utf8"),
			{ strict: false },
		) as unknown as {
			tasks: Array<Record<string, unknown>>;
		};
		assert.equal(stored.tasks.length, 1);
		assert.deepEqual(stored.tasks[0], {
			id: "REALCARD",
			linearId: "real-card-id",
			sourceId: "real-card-id",
			sourceType: "trello",
			title: "Create governance ticket",
			status: "Proposed",
			localStatus: "pending",
			priority: 0,
			labels: ["Governance"],
			description: "Created through ttt",
			url: "https://trello.com/c/REALCARD/create-governance-ticket",
		});
	} finally {
		globalThis.fetch = originalFetch;
		if (originalToonDir === undefined) delete process.env.TOON_DIR;
		else process.env.TOON_DIR = originalToonDir;
		if (originalApiKey === undefined) delete process.env.TRELLO_API_KEY;
		else process.env.TRELLO_API_KEY = originalApiKey;
		if (originalToken === undefined) delete process.env.TRELLO_TOKEN;
		else process.env.TRELLO_TOKEN = originalToken;
		await fs.rm(toonDir, { recursive: true, force: true });
	}
});
