import { test } from "bun:test";
import assert from "node:assert/strict";
import { LinearAdapter } from "./linear-adapter.js";

process.env.LINEAR_API_KEY = "test-key";

function jsonResponse(data: unknown): Response {
	return new Response(JSON.stringify({ data }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function mockLinearFetch(
	states: Array<{ id: string; name: string; type: string }>,
) {
	return async (
		_input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const body = init?.body ? JSON.parse(String(init.body)) : undefined;
		const query = String(body?.query);

		if (query.includes("query issue(")) {
			return jsonResponse({
				issue: {
					__typename: "Issue",
					id: "issue-1",
					identifier: "MP-1",
					title: "Sample issue",
					priority: 0,
					branchName: "feature/mp-1",
					url: "https://linear.app/x/issue/MP-1",
					team: { id: "team-1" },
					reactions: [],
					labelIds: [],
					previousIdentifiers: [],
					reactionData: [],
				},
			});
		}

		if (query.includes("query team(")) {
			return jsonResponse({
				team: { __typename: "Team", id: "team-1", name: "MP", key: "MP" },
			});
		}

		if (query.includes("query workflowStates(")) {
			// Real Linear teams name their cancelled state however they like
			// ("Canceled", "Cancelled", "Done - Cancelled", ...). The adapter
			// must resolve by the state's `type`, which the API reports as
			// "canceled" (one L), never by matching a hardcoded name.
			const typeFilter = body?.variables?.filter?.type;
			const requestedTypes: string[] =
				typeFilter?.in ?? [typeFilter?.eq].filter(Boolean);
			const nodes = states.filter((s) => requestedTypes.includes(s.type));
			return jsonResponse({
				workflowStates: {
					__typename: "WorkflowStateConnection",
					nodes: nodes.map((s) => ({
						__typename: "WorkflowState",
						id: s.id,
						name: s.name,
						type: s.type,
						team: { id: "team-1" },
						description: null,
						position: 0,
						color: "#000000",
						archivedAt: null,
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
						inheritedFrom: null,
					})),
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			});
		}

		if (query.includes("mutation") && query.includes("issueUpdate")) {
			return jsonResponse({
				issueUpdate: {
					__typename: "IssuePayload",
					lastSyncId: 1,
					success: true,
					issue: { id: "issue-1" },
				},
			});
		}

		throw new Error(`Unmocked Linear query: ${query.slice(0, 80)}`);
	};
}

test("LinearAdapter.cancelIssue resolves the Canceled-named state by its cancelled statusType", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = mockLinearFetch([
		{ id: "state-cancelled", name: "Canceled", type: "canceled" },
		{ id: "state-todo", name: "Todo", type: "unstarted" },
	]) as typeof fetch;

	try {
		const adapter = new LinearAdapter();
		const result = await adapter.cancelIssue("issue-1");
		assert.deepEqual(result, { success: true });
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("LinearAdapter.cancelIssue fails loudly instead of silently succeeding when no cancelled-type state exists", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = mockLinearFetch([
		{ id: "state-todo", name: "Todo", type: "unstarted" },
	]) as typeof fetch;

	try {
		const adapter = new LinearAdapter();
		const result = await adapter.cancelIssue("issue-1");
		assert.equal(result.success, false);
		assert.ok(result.error, "a failed cancelIssue must report a named error");
	} finally {
		globalThis.fetch = originalFetch;
	}
});
