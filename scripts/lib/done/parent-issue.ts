/**
 * Parent issue update logic for Linear
 */

import type { Config, QaPmTeamConfig } from "../../utils.js";
import { getLinearClient } from "../../utils.js";
import { getWorkflowStates } from "../linear.js";
import type { ParentUpdateResult } from "./types.js";

/**
 * Update parent issue to a specific status
 */
export async function updateParentStatus(
	parentIssueId: string,
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
 * Update parent issue to testing status (uses QA team config)
 */
export async function updateParentToTesting(
	parentIssueId: string,
	qaPmTeams: QaPmTeamConfig[],
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
