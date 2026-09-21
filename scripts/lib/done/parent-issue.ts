/**
 * Parent issue update logic for Linear
 */

import type { LinearClient } from "@linear/sdk";
import type { Config, QaPmTeamConfig } from "../../utils.js";
import { getLinearClient } from "../../utils.js";
import { getWorkflowStates } from "../linear.js";
import type { ParentUpdateResult } from "./types.js";

const FINISHED_STATE_TYPES = new Set(["completed", "canceled"]);

export interface ChildIssueState {
	identifier: string;
	state?: { name: string; type: string };
}

/**
 * Sub-issues other than the completing one that are still unfinished.
 * A sub-issue is finished once its state is completed/canceled, or once it
 * sits in one of the hand-off statuses (e.g. Testing).
 */
export function listUnfinishedSiblings(
	children: ChildIssueState[],
	childIssueId: string,
	handoffStatuses: readonly string[],
): string[] {
	return children
		.filter((child) => child.identifier !== childIssueId)
		.filter(
			(child) =>
				!child.state ||
				!(
					FINISHED_STATE_TYPES.has(child.state.type) ||
					handoffStatuses.includes(child.state.name)
				),
		)
		.map((child) => child.identifier);
}

export async function findUnfinishedSiblings(
	client: LinearClient,
	parentId: string,
	childIssueId: string,
	handoffStatuses: readonly string[],
): Promise<string[]> {
	const children = await client.issues({
		filter: { parent: { id: { eq: parentId } } },
		first: 250,
	});
	const childStates = await Promise.all(
		children.nodes.map(async (child) => {
			const state = await child.state;
			return {
				identifier: child.identifier,
				state: state ? { name: state.name, type: state.type } : undefined,
			};
		}),
	);
	return listUnfinishedSiblings(childStates, childIssueId, handoffStatuses);
}

/**
 * Update parent issue to a specific status once all its sub-issues are finished
 */
export async function updateParentStatus(
	parentIssueId: string,
	childIssueId: string,
	targetStatus: string,
	_qaPmTeams: QaPmTeamConfig[] | undefined,
	config: Config,
): Promise<ParentUpdateResult> {
	try {
		const client = getLinearClient();
		const searchResult = await client.searchIssues(parentIssueId);
		const parentIssue = searchResult.nodes.find(
			(issue) => issue.identifier === parentIssueId,
		);

		if (!parentIssue) {
			return { success: false };
		}

		const parentTeam = await parentIssue.team;
		if (!parentTeam) {
			return { success: false };
		}

		// Find the matching team configuration
		const teamEntries = Object.entries(config.teams);
		const matchingTeamEntry = teamEntries.find(
			([_, t]) => t.id === parentTeam.id,
		);

		if (!matchingTeamEntry) {
			return { success: false };
		}

		const [parentTeamKey] = matchingTeamEntry;

		// Get workflow states for the parent's team
		const parentStates = await getWorkflowStates(config, parentTeamKey);
		const targetState = parentStates.find((s) => s.name === targetStatus);

		if (!targetState) {
			return { success: false };
		}

		const unfinishedChildren = await findUnfinishedSiblings(
			client,
			parentIssue.id,
			childIssueId,
			[],
		);
		if (unfinishedChildren.length > 0) {
			return { success: false, unfinishedChildren };
		}

		// Update the parent issue
		await client.updateIssue(parentIssue.id, {
			stateId: targetState.id,
		});

		return { success: true, status: targetStatus };
	} catch (error) {
		console.error("Failed to update parent issue:", error);
		return { success: false };
	}
}

/**
 * Update parent issue to testing status (uses QA team config) once all its
 * sub-issues are finished or handed off to testing
 */
export async function updateParentToTesting(
	parentIssueId: string,
	childIssueId: string,
	qaPmTeams: QaPmTeamConfig[],
	config: Config,
	devTestingStatus: string | undefined,
): Promise<ParentUpdateResult> {
	try {
		const client = getLinearClient();
		const searchResult = await client.searchIssues(parentIssueId);
		const parentIssue = searchResult.nodes.find(
			(issue) => issue.identifier === parentIssueId,
		);

		if (!parentIssue) {
			return { success: false };
		}

		const parentTeam = await parentIssue.team;
		if (!parentTeam) {
			return { success: false };
		}

		// Find the matching QA/PM team configuration
		const teamEntries = Object.entries(config.teams);
		const matchingTeamEntry = teamEntries.find(
			([_, t]) => t.id === parentTeam.id,
		);

		if (!matchingTeamEntry) {
			return { success: false };
		}

		const [parentTeamKey] = matchingTeamEntry;

		// Find the QA/PM team config for this parent's team
		const qaPmConfig = qaPmTeams.find((qp) => qp.team === parentTeamKey);

		if (!qaPmConfig) {
			// Parent's team is not in the configured QA/PM teams
			return { success: false };
		}

		// Get workflow states for the parent's team
		const parentStates = await getWorkflowStates(config, parentTeamKey);
		const testingState = parentStates.find(
			(s) => s.name === qaPmConfig.testing_status,
		);

		if (!testingState) {
			return { success: false };
		}

		const handoffStatuses = qaPmTeams.map((qp) => qp.testing_status);
		if (devTestingStatus) {
			handoffStatuses.push(devTestingStatus);
		}
		const unfinishedChildren = await findUnfinishedSiblings(
			client,
			parentIssue.id,
			childIssueId,
			handoffStatuses,
		);
		if (unfinishedChildren.length > 0) {
			return { success: false, unfinishedChildren };
		}

		// Update the parent issue
		await client.updateIssue(parentIssue.id, {
			stateId: testingState.id,
		});

		return { success: true, testingStatus: qaPmConfig.testing_status };
	} catch (error) {
		console.error("Failed to update parent issue:", error);
		return { success: false };
	}
}
