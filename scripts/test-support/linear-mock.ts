/**
 * Preloaded (`bun --preload`) into CLI subprocesses so they talk to a fake
 * Linear. Each GraphQL request is appended to MOCK_LINEAR_LOG as one JSON line
 * `{ name, variables }`, which lets tests assert on what the CLI asked for.
 *
 * Without MOCK_LINEAR_STATE the fake holds one ticket, MP-7. With it, the
 * file it names holds the tickets as JSON
 * `{ issues: { "MP-1": { state, parent?, comments? } } }`; status updates and
 * new comments are written back, so a test can run several CLI processes
 * against one fake workspace and read the result.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const STATES = [
	{ id: "s-backlog", name: "Backlog", type: "backlog" },
	{ id: "s-todo", name: "Todo", type: "unstarted" },
	{ id: "s-progress", name: "In Progress", type: "started" },
	{ id: "s-review", name: "In Review", type: "started" },
	{ id: "s-code-review", name: "Code Review", type: "started" },
	{ id: "s-done", name: "Done", type: "completed" },
	{ id: "s-canceled", name: "Canceled", type: "canceled" },
];

interface MockIssue {
	/** Workflow state id, e.g. "s-review" */
	state: string;
	/** Identifier of the parent ticket */
	parent?: string;
	comments?: string[];
}

interface MockState {
	issues: Record<string, MockIssue>;
}

const statePath = process.env.MOCK_LINEAR_STATE;

function loadState(): MockState {
	if (statePath) return JSON.parse(readFileSync(statePath, "utf8"));
	// MOCK_LINEAR_ISSUE_STATE picks the workflow state the fake MP-7 sits in.
	return {
		issues: {
			"MP-7": { state: process.env.MOCK_LINEAR_ISSUE_STATE ?? "s-backlog" },
		},
	};
}

function saveState(state: MockState): void {
	if (statePath) writeFileSync(statePath, JSON.stringify(state, null, 2));
}

const uuid = (identifier: string) =>
	identifier === "MP-7" && !statePath ? "uuid-backlog-7" : `uuid-${identifier}`;

function issueNode(identifier: string, issue: MockIssue) {
	return {
		__typename: "Issue",
		id: uuid(identifier),
		identifier,
		title: statePath ? `Task ${identifier}` : "Backlog follow-up",
		priority: 3,
		branchName: identifier.toLowerCase(),
		url: `https://linear.app/x/issue/${identifier}`,
		team: { id: "team-dev" },
		state: { id: issue.state },
		parent: issue.parent ? { id: uuid(issue.parent) } : undefined,
		labelIds: [],
		previousIdentifiers: [],
		reactionData: [],
		reactions: [],
	};
}

function findByUuid(
	state: MockState,
	id: string | undefined,
): [string, MockIssue] | undefined {
	return Object.entries(state.issues).find(
		([key]) => uuid(key) === id || key === id,
	);
}

const page = (name: string, nodes: unknown[]) => ({
	[name]: {
		__typename: "Connection",
		nodes,
		pageInfo: { hasNextPage: false, endCursor: null },
	},
});

interface Variables {
	id?: string;
	term?: string;
	first?: number;
	after?: string;
	filter?: { parent?: { id?: { eq?: string } } };
	input?: { stateId?: string; issueId?: string; body?: string };
}

function respond(
	query: string,
	variables: Variables = {},
): Record<string, unknown> {
	const state = loadState();
	const allIssues = () =>
		Object.entries(state.issues).map(([key, issue]) => issueNode(key, issue));

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
	if (query.includes("query team(")) {
		return { team: { __typename: "Team", id: variables.id, name: "Dev" } };
	}
	if (query.includes("query issues(")) {
		const parentId = variables.filter?.parent?.id?.eq;
		return page(
			"issues",
			parentId
				? Object.entries(state.issues)
						.filter(
							([, issue]) => issue.parent && uuid(issue.parent) === parentId,
						)
						.map(([key, issue]) => issueNode(key, issue))
				: allIssues(),
		);
	}
	if (query.includes("query searchIssues(")) {
		// MOCK_LINEAR_SEARCH_MISS hides tickets from full-text search, as an
		// index that has not caught up does
		const hidden = (process.env.MOCK_LINEAR_SEARCH_MISS ?? "").split(",");
		const nodes = allIssues().filter(
			(node) => !hidden.includes((node as { identifier: string }).identifier),
		);
		return {
			searchIssues: {
				__typename: "IssueSearchPayload",
				totalCount: nodes.length,
				archivePayload: { __typename: "ArchiveResponse", archive: null },
				pageInfo: { hasNextPage: false, endCursor: null },
				nodes,
			},
		};
	}
	if (query.includes("query issue(")) {
		const found = findByUuid(state, variables.id);
		if (!found) throw new Error(`Unknown mock issue: ${variables.id}`);
		return { issue: issueNode(...found) };
	}
	if (query.includes("query issue_comments(")) {
		// Paged like Linear: 50 by default, `first`/`after` pick the window
		const comments = findByUuid(state, variables.id)?.[1].comments ?? [];
		const start = variables.after ? Number(variables.after) : 0;
		const end = Math.min(comments.length, start + (variables.first ?? 50));
		return {
			issue: {
				comments: {
					__typename: "CommentConnection",
					pageInfo: {
						hasNextPage: end < comments.length,
						endCursor: String(end),
					},
					nodes: comments.slice(start, end).map((body, offset) => ({
						__typename: "Comment",
						id: `comment-${start + offset}`,
						body,
						createdAt: "2026-11-01T00:00:00.000Z",
						reactionData: [],
						reactions: [],
					})),
				},
			},
		};
	}
	if (query.includes("query issueLabels(")) return page("issueLabels", []);
	if (query.includes("mutation") && query.includes("issueUpdate")) {
		const found = findByUuid(state, variables.id);
		if (!found) throw new Error(`Unknown mock issue: ${variables.id}`);
		const [identifier, issue] = found;
		// MOCK_LINEAR_FAIL_UPDATE names tickets whose status update is refused.
		const refused = (process.env.MOCK_LINEAR_FAIL_UPDATE ?? "")
			.split(",")
			.includes(identifier);
		if (!refused && variables.input?.stateId) {
			issue.state = variables.input.stateId;
			saveState(state);
		}
		return {
			issueUpdate: {
				__typename: "IssuePayload",
				success: !refused,
				issue: issueNode(identifier, issue),
			},
		};
	}
	if (query.includes("mutation") && query.includes("commentCreate")) {
		const found = findByUuid(state, variables.input?.issueId);
		if (!found) {
			throw new Error(`Unknown mock issue: ${variables.input?.issueId}`);
		}
		found[1].comments = [
			...(found[1].comments ?? []),
			variables.input?.body ?? "",
		];
		saveState(state);
		return {
			commentCreate: {
				__typename: "CommentPayload",
				success: true,
				lastSyncId: 1,
				comment: { id: `comment-${found[1].comments.length - 1}` },
			},
		};
	}
	// Empty relation connections: `query issue_labels(`, `issue_attachments(`, ...
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
