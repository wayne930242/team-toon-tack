import assert from "node:assert/strict";
import { test } from "node:test";
import { TrelloAdapter } from "./trello-adapter.js";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

test("TrelloAdapter.createIssue creates exactly one card and returns its real identity", async () => {
	const requests: Array<{ method: string; url: URL; body?: unknown }> = [];
	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));
		const method = init?.method ?? "GET";
		const body = init?.body ? JSON.parse(String(init.body)) : undefined;
		requests.push({ method, url, body });

		if (url.pathname === "/1/boards/board-1/lists") {
			return jsonResponse([
				{
					id: "list-todo",
					name: "Todo",
					closed: false,
					pos: 1,
					idBoard: "board-1",
				},
			]);
		}
		if (url.pathname === "/1/boards/board-1/labels") {
			return jsonResponse([
				{ id: "label-bug", idBoard: "board-1", name: "Bug", color: "red" },
				{
					id: "label-high",
					idBoard: "board-1",
					name: "High",
					color: "orange",
				},
			]);
		}
		if (url.pathname === "/1/cards" && method === "POST") {
			assert.deepEqual(body, {
				name: "Governance ticket",
				idList: "list-todo",
				desc: "Use the approved workflow",
				idMembers: ["member-1"],
				idLabels: ["label-bug", "label-high"],
			});
			return jsonResponse({
				id: "card-real-id",
				name: "Governance ticket",
				desc: "Use the approved workflow",
				url: "https://trello.com/c/REAL1234/governance-ticket",
				shortUrl: "https://trello.com/c/REAL1234",
				shortLink: "REAL1234",
				closed: false,
				pos: 42,
				due: null,
				dueComplete: false,
				idBoard: "board-1",
				idList: "list-todo",
				idMembers: ["member-1"],
				idLabels: ["label-bug", "label-high"],
				labels: [
					{
						id: "label-bug",
						idBoard: "board-1",
						name: "Bug",
						color: "red",
					},
					{
						id: "label-high",
						idBoard: "board-1",
						name: "High",
						color: "orange",
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

		throw new Error(`Unexpected request: ${method} ${url.pathname}`);
	};

	try {
		const adapter = new TrelloAdapter("key", "token");
		const result = await adapter.createIssue({
			teamId: "board-1",
			title: "Governance ticket",
			description: "Use the approved workflow",
			assigneeId: "member-1",
			priority: 2,
			labelIds: ["label-bug"],
			statusId: "list-todo",
		});

		assert.deepEqual(result, {
			success: true,
			issue: {
				id: "REAL1234",
				sourceId: "card-real-id",
				title: "Governance ticket",
				description: "Use the approved workflow",
				status: "Todo",
				statusId: "list-todo",
				assigneeId: "member-1",
				assigneeEmail: undefined,
				priority: 2,
				labels: ["Bug", "High"],
				url: "https://trello.com/c/REAL1234/governance-ticket",
				parentIssueId: undefined,
				branchName: undefined,
				attachments: undefined,
				comments: undefined,
			},
		});
		assert.equal(
			requests.filter(
				(request) =>
					request.method === "POST" && request.url.pathname === "/1/cards",
			).length,
			1,
		);
		assert.equal(
			requests.some((request) => request.url.pathname.includes("card-real-id")),
			false,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("TrelloAdapter.createIssue fails before mutation when no list is available", async () => {
	let postCount = 0;
	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));
		if (init?.method === "POST") postCount += 1;
		if (url.pathname === "/1/boards/board-1/lists") return jsonResponse([]);
		throw new Error(
			`Unexpected request: ${init?.method ?? "GET"} ${url.pathname}`,
		);
	};

	try {
		const result = await new TrelloAdapter("key", "token").createIssue({
			teamId: "board-1",
			title: "No list",
		});
		assert.deepEqual(result, {
			success: false,
			error: "Trello board board-1 has no open lists",
		});
		assert.equal(postCount, 0);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("TrelloAdapter.createIssue fails before mutation when the requested priority label is absent", async () => {
	let postCount = 0;
	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));
		if (init?.method === "POST") postCount += 1;
		if (url.pathname === "/1/boards/board-1/lists") {
			return jsonResponse([
				{
					id: "list-todo",
					name: "Todo",
					closed: false,
					pos: 1,
					idBoard: "board-1",
				},
			]);
		}
		if (url.pathname === "/1/boards/board-1/labels") return jsonResponse([]);
		throw new Error(
			`Unexpected request: ${init?.method ?? "GET"} ${url.pathname}`,
		);
	};

	try {
		const result = await new TrelloAdapter("key", "token").createIssue({
			teamId: "board-1",
			title: "Missing priority label",
			priority: 1,
		});
		assert.deepEqual(result, {
			success: false,
			error: 'Trello board board-1 has no label matching priority "urgent"',
		});
		assert.equal(postCount, 0);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("TrelloAdapter.createIssue returns the Trello API failure without retrying creation", async () => {
	let postCount = 0;
	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));
		if (url.pathname === "/1/boards/board-1/lists") {
			return jsonResponse([
				{
					id: "list-todo",
					name: "Todo",
					closed: false,
					pos: 1,
					idBoard: "board-1",
				},
			]);
		}
		if (url.pathname === "/1/cards" && init?.method === "POST") {
			postCount += 1;
			return jsonResponse("rate limited", 429);
		}
		throw new Error(
			`Unexpected request: ${init?.method ?? "GET"} ${url.pathname}`,
		);
	};

	try {
		const result = await new TrelloAdapter("key", "token").createIssue({
			teamId: "board-1",
			title: "Rejected card",
		});
		assert.deepEqual(result, {
			success: false,
			error: "Trello API error (429): rate limited",
		});
		assert.equal(postCount, 1);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
