/**
 * Preloaded (`bun --preload`) into CLI subprocesses so they talk to a fake
 * Linear. Each GraphQL request is appended to MOCK_LINEAR_LOG as one JSON line
 * `{ name, variables }`, which lets tests assert on what the CLI asked for.
 */
import { appendFileSync } from "node:fs";

const STATES = [
	{ id: "s-backlog", name: "Backlog", type: "backlog" },
	{ id: "s-todo", name: "Todo", type: "unstarted" },
	{ id: "s-progress", name: "In Progress", type: "started" },
	{ id: "s-canceled", name: "Canceled", type: "canceled" },
];

const ISSUE = {
	__typename: "Issue",
	id: "uuid-backlog-7",
	identifier: "MP-7",
	title: "Backlog follow-up",
	priority: 3,
	branchName: "mp-7",
	url: "https://linear.app/x/issue/MP-7",
	team: { id: "team-dev" },
	// MOCK_LINEAR_ISSUE_STATE picks the workflow state the fake MP-7 sits in.
	state: { id: process.env.MOCK_LINEAR_ISSUE_STATE ?? "s-backlog" },
	labelIds: [],
	previousIdentifiers: [],
	reactionData: [],
	reactions: [],
};

const page = (name: string, nodes: unknown[]) => ({
	[name]: {
		__typename: "Connection",
		nodes,
		pageInfo: { hasNextPage: false, endCursor: null },
	},
});

function respond(
	query: string,
	variables: { id?: string } = {},
): Record<string, unknown> {
	if (query.includes("query workflowStates(")) {
		return page(
			"workflowStates",
			STATES.map((s) => ({ __typename: "WorkflowState", ...s })),
		);
	}
	if (query.includes("query workflowState(")) {
		return {
			workflowState: {
				__typename: "WorkflowState",
				...(STATES.find((s) => s.id === variables.id) ?? STATES[0]),
			},
		};
	}
	if (query.includes("query issues(")) {
		return page("issues", [ISSUE]);
	}
	if (query.includes("query searchIssues(")) {
		return {
			searchIssues: {
				__typename: "IssueSearchPayload",
				totalCount: 1,
				archivePayload: { __typename: "ArchiveResponse", archive: null },
				pageInfo: { hasNextPage: false, endCursor: null },
				nodes: [ISSUE],
			},
		};
	}
	if (query.includes("query issue(")) return { issue: ISSUE };
	if (query.includes("query issueLabels(")) return page("issueLabels", []);
	if (query.includes("mutation") && query.includes("issueUpdate")) {
		return {
			issueUpdate: { __typename: "IssuePayload", success: true, issue: ISSUE },
		};
	}
	// Empty relation connections: `query issue_labels(`, `issue_comments(`, ...
	const relation = /query issue_(\w+)\(/.exec(query)?.[1];
	if (relation) return { issue: page(relation, []) };
	throw new Error(`Unmocked Linear query: ${query.slice(0, 80)}`);
}

globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
	const body = JSON.parse(String(init?.body));
	const name = /(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1];
	if (process.env.MOCK_LINEAR_LOG) {
		appendFileSync(
			process.env.MOCK_LINEAR_LOG,
			`${JSON.stringify({ name, variables: body.variables })}\n`,
		);
	}
	return new Response(
		JSON.stringify({ data: respond(String(body.query), body.variables) }),
		{
			status: 200,
			headers: { "Content-Type": "application/json" },
		},
	);
}) as typeof fetch;
