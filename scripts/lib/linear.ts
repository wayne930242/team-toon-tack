import {
	type Config,
	getLinearClient,
	getTeamId,
	type StatusTransitions,
} from "../utils.js";

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
			await client.updateIssue(linearId, { stateId: targetState.id });
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
	localStatus: "pending" | "in-progress" | "in-review" | "completed" | "blocked",
	config: Config,
): string | undefined {
	const transitions = getStatusTransitions(config);
	switch (localStatus) {
		case "pending":
			return transitions.todo;
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
