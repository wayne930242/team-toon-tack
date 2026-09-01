import type { Issue, LinearClient } from "@linear/sdk";
import {
	type Config,
	getLinearClient,
	getTeamId,
	type StatusTransitions,
	withRetry,
} from "../utils.js";
import { getFirstTodoStatus } from "./status-helpers.js";

/** Issues requested per Linear API page. */
export const ISSUE_PAGE_SIZE = 100;
/** Hard stop so a broad filter can't pull an entire backlog. */
export const MAX_FETCHED_ISSUES = 500;

/**
 * Fetch every issue matching `filter`, following pagination. Without this a
 * single `first: n` request silently returns whichever page Linear hands back
 * first, dropping the rest with no signal. `truncated` reports that `cap` cut
 * the result short.
 */
export async function fetchIssuesPaged(
	client: LinearClient,
	filter: Record<string, unknown>,
	label: string,
	cap: number = MAX_FETCHED_ISSUES,
): Promise<{ nodes: Issue[]; truncated: boolean }> {
	const connection = await withRetry(
		() => client.issues({ filter, first: ISSUE_PAGE_SIZE }),
		{ label },
	);

	while (connection.pageInfo.hasNextPage && connection.nodes.length < cap) {
		const before = connection.nodes.length;
		await withRetry(() => connection.fetchNext(), {
			label: `${label} (next page)`,
		});
		if (connection.nodes.length === before) break;
	}

	return {
		nodes: connection.nodes.slice(0, cap),
		truncated: connection.nodes.length > cap || connection.pageInfo.hasNextPage,
	};
}

export interface WorkflowStateInfo {
	id: string;
	name: string;
	type: string;
}

export async function getWorkflowStates(
	config: Config,
	teamKey: string,
): Promise<WorkflowStateInfo[]> {
	const client = getLinearClient();
	const teamId = getTeamId(config, teamKey);
	const statesData = await client.workflowStates({
		filter: { team: { id: { eq: teamId } } },
	});
	return statesData.nodes.map((s) => ({
		id: s.id,
		name: s.name,
		type: s.type,
	}));
}

export function getStatusTransitions(config: Config): StatusTransitions {
	return (
		config.status_transitions || {
			todo: "Todo",
			in_progress: "In Progress",
			done: "Done",
			testing: "Testing",
		}
	);
}

export async function updateIssueStatus(
	linearId: string,
	targetStatusName: string,
	config: Config,
	teamKey: string,
): Promise<boolean> {
	try {
		const client = getLinearClient();
		const states = await getWorkflowStates(config, teamKey);
		const targetState = states.find((s) => s.name === targetStatusName);

		if (targetState) {
			const payload = await client.updateIssue(linearId, {
				stateId: targetState.id,
			});
			if (!payload.success) {
				console.error(
					`Failed to update Linear: mutation returned success=false for ${linearId} → ${targetStatusName}`,
				);
				return false;
			}
			return true;
		}
		return false;
	} catch (e) {
		console.error("Failed to update Linear:", e);
		return false;
	}
}

export async function addComment(
	issueId: string,
	body: string,
): Promise<boolean> {
	try {
		const client = getLinearClient();
		await client.createComment({ issueId, body });
		return true;
	} catch (e) {
		console.error("Failed to add comment:", e);
		return false;
	}
}

export function mapLocalStatusToLinear(
	localStatus:
		| "pending"
		| "in-progress"
		| "in-review"
		| "completed"
		| "blocked",
	config: Config,
): string | undefined {
	const transitions = getStatusTransitions(config);
	switch (localStatus) {
		case "pending":
			return getFirstTodoStatus(transitions.todo);
		case "in-progress":
			return transitions.in_progress;
		case "in-review":
			return transitions.testing;
		case "completed":
			return transitions.done;
		case "blocked":
			return transitions.blocked;
		default:
			return undefined;
	}
}
