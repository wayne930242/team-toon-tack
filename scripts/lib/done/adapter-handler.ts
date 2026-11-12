/**
 * Completion through the task source adapter, for sources without Linear's
 * completion modes (Trello, the local board): move to the done status and
 * comment the commit.
 */

import { getSourceName } from "../../utils.js";
import { createAdapter } from "../adapters/index.js";
import { buildCompletionComment } from "../git.js";
import { getStatusTransitions } from "../linear.js";
import type { CompletionContext, CompletionResult } from "./types.js";

export async function handleAdapterCompletion(
	context: CompletionContext,
): Promise<CompletionResult> {
	const { task, config, localConfig, commit, promptMessage } = context;
	const sourceId = task.sourceId ?? task.linearId;

	if (!sourceId) {
		return { success: false, message: "No source ID found" };
	}

	const transitions = getStatusTransitions(config);
	const sourceName = getSourceName(config);

	try {
		const adapter = createAdapter(config);
		const teamId = config.teams[localConfig.team]?.id;

		if (!teamId) {
			return { success: false, message: "Team not found" };
		}

		const statuses = await adapter.getStatuses(teamId);
		const doneStatus = statuses.find((s) => s.name === transitions.done);

		if (!doneStatus) {
			return { success: false, message: "Done status not found" };
		}

		// Update status
		const result = await adapter.updateIssueStatus(sourceId, doneStatus.id);
		if (result.success) {
			console.log(`${sourceName}: ${task.id} → ${transitions.done}`);
		} else {
			return {
				success: false,
				message:
					result.error || `Failed to move ${task.id} to ${transitions.done}`,
			};
		}

		// Add comment with commit info (only if promptMessage provided)
		if (commit && promptMessage) {
			const commentBody = buildCompletionComment(commit, promptMessage);
			const commentResult = await adapter.addComment(sourceId, commentBody);
			if (commentResult.success) {
				console.log(`${sourceName}: 已新增 commit 留言`);
			}
		}

		return { success: true, status: transitions.done };
	} catch (error) {
		console.error(`Failed to update ${sourceName}:`, error);
		return { success: false, message: String(error) };
	}
}
