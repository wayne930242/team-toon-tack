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
 *
 * Creates (issues, comments, labels, relations) take the client's `id`, as
 * Linear does, and refuse an id that exists. A missing entity is answered
 * with Linear's "Entity not found" GraphQL error. Created issues are numbered
 * ENG-<n> (team-dev's key).
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
	/** Ids of `comments`, same order, for comments created with an id */
	commentIds?: string[];
	/** UUID; default uuid-<identifier> */
	id?: string;
	title?: string;
	description?: string;
	priority?: number;
	labelIds?: string[];
	assigneeId?: string;
	estimate?: number;
	createdAt?: string;
}

interface MockState {
	issues: Record<string, MockIssue>;
	labels?: { id: string; name: string; color?: string }[];
	relations?: {
		id: string;
		issueId: string;
		relatedIssueId: string;
		type: string;
	}[];
	nextNumber?: number;
}

// MOCK_LINEAR_ESTIMATION="<type>[,extended][,zero]": the team's estimate
// scale (default fibonacci). An estimate off the scale is refused.
const [estimationType = "fibonacci", ...estimationFlags] = envList(
	"MOCK_LINEAR_ESTIMATION",
);
const TEAM = {
	id: "team-dev",
	name: "Dev",
	key: "ENG",
	issueEstimationType: estimationType,
	issueEstimationExtended: estimationFlags.includes("extended"),
	issueEstimationAllowZero: estimationFlags.includes("zero"),
};
const SCALES: Record<string, number[]> = {
	exponential: [1, 2, 4, 8, 16, 32, 64],
	fibonacci: [1, 2, 3, 5, 8, 13, 21],
	linear: [1, 2, 3, 4, 5, 6, 7],
	tShirt: [1, 2, 3, 5, 8, 13, 21],
};

function checkEstimate(estimate: number | null | undefined): void {
	if (estimate === undefined || estimate === null) return;
	const scale = (SCALES[TEAM.issueEstimationType] ?? []).slice(
		0,
		TEAM.issueEstimationExtended ? 7 : 5,
	);
	if (TEAM.issueEstimationAllowZero) scale.push(0);
	if (!scale.includes(estimate)) {
		throw new InputError(
			`Argument Validation Error: estimate ${estimate} is not on the team's scale`,
		);
	}
}
const USERS = [
	{
		id: "u-alice",
		name: "Alice",
		displayName: "alice",
		email: "alice@example.com",
		active: true,
	},
	{
		id: "u-zed",
		name: "Zed",
		displayName: "zed",
		email: "zed@example.com",
		active: true,
	},
];

/** Answered as a GraphQL error, the way Linear reports bad input. */
class InputError extends Error {}
/** A missing entity, as Linear reports it. */
class NotFound extends InputError {}

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

let currentState: MockState | undefined;

const uuid = (identifier: string) =>
	currentState?.issues[identifier]?.id ??
	(identifier === "MP-7" && !statePath
		? "uuid-backlog-7"
		: `uuid-${identifier}`);

function issueNode(identifier: string, issue: MockIssue) {
	return {
		__typename: "Issue",
		id: uuid(identifier),
		identifier,
		title:
			issue.title ?? (statePath ? `Task ${identifier}` : "Backlog follow-up"),
		description: issue.description,
		priority: issue.priority ?? 3,
		estimate: issue.estimate,
		branchName: identifier.toLowerCase(),
		url: `https://linear.app/x/issue/${identifier}`,
		team: { id: "team-dev" },
		state: { id: issue.state },
		parent: issue.parent ? { id: uuid(issue.parent) } : undefined,
		labelIds: issue.labelIds ?? [],
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
	input?: {
		id?: string;
		stateId?: string;
		issueId?: string;
		relatedIssueId?: string;
		type?: string;
		body?: string;
		title?: string;
		description?: string | null;
		priority?: number;
		labelIds?: string[];
		assigneeId?: string | null;
		parentId?: string | null;
		estimate?: number | null;
		createdAt?: string;
		name?: string;
		color?: string;
	};
}

function envList(name: string): string[] {
	return (process.env[name] ?? "").split(",").filter(Boolean);
}

function idTaken(state: MockState, id: string | undefined): boolean {
	if (!id) return false;
	return (
		Object.keys(state.issues).some((key) => uuid(key) === id) ||
		Object.values(state.issues).some((i) => i.commentIds?.includes(id)) ||
		(state.labels ?? []).some((l) => l.id === id) ||
		(state.relations ?? []).some((r) => r.id === id)
	);
}

function respond(
	query: string,
	variables: Variables = {},
): Record<string, unknown> {
	const state = loadState();
	currentState = state;
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
		return { team: { __typename: "Team", ...TEAM, id: variables.id } };
	}
	if (query.includes("query teams(")) {
		return page("teams", [{ __typename: "Team", ...TEAM }]);
	}
	if (query.includes("query users(")) {
		// MOCK_LINEAR_DUPLICATE_USER=Alice adds a second user of that name
		const twin = process.env.MOCK_LINEAR_DUPLICATE_USER;
		const users = twin
			? [
					...USERS,
					{
						id: "u-twin",
						name: twin,
						displayName: `${twin.toLowerCase()}2`,
						email: `${twin.toLowerCase()}2@example.com`,
						active: true,
					},
				]
			: USERS;
		return page(
			"users",
			users.map((u) => ({ __typename: "User", ...u })),
		);
	}
	if (query.includes("query issueLabel(")) {
		const label = (state.labels ?? []).find((l) => l.id === variables.id);
		if (!label) throw new NotFound("Entity not found: IssueLabel");
		return { issueLabel: { __typename: "IssueLabel", ...label } };
	}
	if (query.includes("query issueRelation(")) {
		const relation = (state.relations ?? []).find((r) => r.id === variables.id);
		if (!relation) throw new NotFound("Entity not found: IssueRelation");
		return { issueRelation: { __typename: "IssueRelation", ...relation } };
	}
	if (query.includes("query comment(")) {
		for (const issue of Object.values(state.issues)) {
			const index = issue.commentIds?.indexOf(variables.id ?? "") ?? -1;
			if (index >= 0) {
				return {
					comment: {
						__typename: "Comment",
						id: variables.id,
						body: issue.comments?.[index] ?? "",
						createdAt: "2026-11-01T00:00:00.000Z",
						reactionData: [],
						reactions: [],
					},
				};
			}
		}
		throw new NotFound("Entity not found: Comment");
	}
	if (query.includes("mutation") && query.includes("issueCreate")) {
		const input = variables.input ?? {};
		if (envList("MOCK_LINEAR_FAIL_CREATE").includes(input.title ?? "")) {
			throw new Error(`Refused to create "${input.title}"`);
		}
		if (idTaken(state, input.id)) {
			throw new Error(`Entity already exists: ${input.id}`);
		}
		checkEstimate(input.estimate);
		const number = state.nextNumber ?? 1;
		state.nextNumber = number + 1;
		const identifier = `${TEAM.key}-${number}`;
		const parent = Object.keys(state.issues).find(
			(key) => uuid(key) === input.parentId,
		);
		state.issues[identifier] = {
			id: input.id ?? `uuid-${identifier}`,
			state: input.stateId ?? "s-todo",
			title: input.title,
			description: input.description ?? undefined,
			priority: input.priority,
			labelIds: input.labelIds,
			assigneeId: input.assigneeId ?? undefined,
			estimate: input.estimate ?? undefined,
			createdAt: input.createdAt,
			parent,
		};
		saveState(state);
		if (envList("MOCK_LINEAR_CRASH_AFTER_CREATE").includes(input.title ?? "")) {
			// The process dies after Linear stored the issue, before any answer
			process.exit(137);
		}
		return {
			issueCreate: {
				__typename: "IssuePayload",
				success: true,
				lastSyncId: 1,
				issue: issueNode(identifier, state.issues[identifier]),
			},
		};
	}
	if (query.includes("mutation") && query.includes("issueLabelCreate")) {
		const input = variables.input ?? {};
		if (envList("MOCK_LINEAR_FAIL_CREATE").includes(input.name ?? "")) {
			throw new Error(`Refused to create "${input.name}"`);
		}
		if (idTaken(state, input.id)) {
			throw new Error(`Entity already exists: ${input.id}`);
		}
		const lower = (input.name ?? "").toLowerCase();
		if ((state.labels ?? []).some((l) => l.name.toLowerCase() === lower)) {
			throw new InputError(`Duplicate label name: ${input.name}`);
		}
		const label = {
			id: input.id ?? `label-${input.name}`,
			name: input.name ?? "",
			...(input.color ? { color: input.color } : {}),
		};
		state.labels = [...(state.labels ?? []), label];
		saveState(state);
		return {
			issueLabelCreate: {
				__typename: "IssueLabelPayload",
				success: true,
				lastSyncId: 1,
				issueLabel: { __typename: "IssueLabel", ...label },
			},
		};
	}
	if (query.includes("mutation") && query.includes("issueRelationCreate")) {
		const input = variables.input ?? {};
		if (idTaken(state, input.id)) {
			throw new Error(`Entity already exists: ${input.id}`);
		}
		for (const end of [input.issueId, input.relatedIssueId]) {
			if (!findByUuid(state, end)) {
				throw new NotFound(`Entity not found: Issue - ${end}`);
			}
		}
		const relation = {
			id: input.id ?? `relation-${(state.relations ?? []).length}`,
			issueId: input.issueId ?? "",
			relatedIssueId: input.relatedIssueId ?? "",
			type: input.type ?? "related",
		};
		state.relations = [...(state.relations ?? []), relation];
		saveState(state);
		return {
			issueRelationCreate: {
				__typename: "IssueRelationPayload",
				success: true,
				lastSyncId: 1,
				issueRelation: { __typename: "IssueRelation", ...relation },
			},
		};
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
		if (!found) {
			throw new NotFound(
				`Entity not found: Issue - Unknown mock issue: ${variables.id}`,
			);
		}
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
	if (query.includes("query issueLabels(")) {
		return page(
			"issueLabels",
			(state.labels ?? []).map((l) => ({ __typename: "IssueLabel", ...l })),
		);
	}
	if (query.includes("mutation") && query.includes("issueUpdate")) {
		const found = findByUuid(state, variables.id);
		if (!found) throw new Error(`Unknown mock issue: ${variables.id}`);
		const [identifier, issue] = found;
		// MOCK_LINEAR_FAIL_UPDATE names tickets whose status update is refused.
		const refused = (process.env.MOCK_LINEAR_FAIL_UPDATE ?? "")
			.split(",")
			.includes(identifier);
		const input = variables.input ?? {};
		checkEstimate(input.estimate);
		if (!refused) {
			if (input.stateId) issue.state = input.stateId;
			if (input.parentId !== undefined) {
				issue.parent =
					input.parentId === null
						? undefined
						: Object.keys(state.issues).find(
								(key) => uuid(key) === input.parentId,
							);
			}
			// Any other field the update names, null clearing it
			for (const field of [
				"title",
				"description",
				"priority",
				"labelIds",
				"assigneeId",
				"estimate",
			] as const) {
				if (field in input) {
					(issue as unknown as Record<string, unknown>)[field] =
						input[field] ?? undefined;
				}
			}
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
		if (idTaken(state, variables.input?.id)) {
			throw new Error(`Entity already exists: ${variables.input?.id}`);
		}
		found[1].comments = [
			...(found[1].comments ?? []),
			variables.input?.body ?? "",
		];
		const commentId =
			variables.input?.id ?? `comment-${found[1].comments.length - 1}`;
		if (variables.input?.id || found[1].commentIds) {
			// Pad ids of comments seeded without one
			const ids = found[1].commentIds ?? [];
			while (ids.length < found[1].comments.length - 1) {
				ids.push(`comment-${ids.length}`);
			}
			ids.push(commentId);
			found[1].commentIds = ids;
		}
		saveState(state);
		return {
			commentCreate: {
				__typename: "CommentPayload",
				success: true,
				lastSyncId: 1,
				comment: { id: commentId },
			},
		};
	}
	// Empty relation connections: `query issue_labels(`, `issue_attachments(`, ...
	const relation = /query issue_(\w+)\(/.exec(query)?.[1];
	if (relation) return { issue: page(relation, []) };
	throw new Error(`Unmocked Linear query: ${query.slice(0, 80)}`);
}

/** MOCK_LINEAR_DELAY="teams=1500,...": hold these operations that many ms. */
function delayFor(name: string | undefined): number {
	for (const item of envList("MOCK_LINEAR_DELAY")) {
		const [op, ms] = item.split("=");
		if (op === name) return Number(ms);
	}
	return 0;
}

globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
	const body = JSON.parse(String(init?.body));
	const name = /(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1];
	const delay = delayFor(name);
	if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
	if (process.env.MOCK_LINEAR_LOG) {
		appendFileSync(
			process.env.MOCK_LINEAR_LOG,
			`${JSON.stringify({ name, variables: body.variables })}\n`,
		);
	}
	let payload: unknown;
	try {
		payload = { data: respond(String(body.query), body.variables) };
	} catch (error) {
		if (!(error instanceof InputError)) throw error;
		payload = {
			data: null,
			errors: [
				{
					message: error.message,
					extensions: { type: "invalid input", code: "INPUT_ERROR" },
				},
			],
		};
	}
	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}) as typeof fetch;
