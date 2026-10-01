/**
 * Linear completion handler
 */

import type { CompletionMode } from "../../utils.js";
import { buildCompletionComment } from "../git.js";
import {
	addComment,
	getStatusTransitions,
	updateIssueStatus,
} from "../linear.js";
import { updateParentStatus, updateParentToTesting } from "./parent-issue.js";
import type { CompletionContext, CompletionResult } from "./types.js";

/** Linear calls the completion handlers make; injectable so tests need no network. */
export interface CompletionDeps {
	updateIssueStatus: typeof updateIssueStatus;
	updateParentToTesting: typeof updateParentToTesting;
}

const defaultDeps: CompletionDeps = {
	updateIssueStatus,
	updateParentToTesting,
};

const STRICT_FALLBACK_HINT =
	'completion_mode is upstream_strict; set it to "upstream_not_strict" or "simple" (ttt config) to keep Done';

function logParentUnchanged(
	parentIssueId: string,
	unfinishedChildren: string[],
): void {
	console.log(
		`Linear: Parent ${parentIssueId} unchanged (unfinished sub-issues: ${unfinishedChildren.join(", ")})`,
	);
}

/**
 * Handle simple completion mode
 * Mark task as done, also mark parent as done once all its sub-issues are finished
 */
async function handleSimpleCompletion(
	context: CompletionContext,
): Promise<CompletionResult> {
	const { task, config, localConfig } = context;
	const transitions = getStatusTransitions(config);

	// Mark task as done
	const success = await updateIssueStatus(
		task.linearId,
		transitions.done,
		config,
		localConfig.team,
	);
	if (success) {
		console.log(`Linear: ${task.id} → ${transitions.done}`);
	} else {
		return {
			success: false,
			status: task.status,
			message: `Failed to move ${task.id} to ${transitions.done}`,
		};
	}

	// Also mark parent as done if exists
	if (task.parentIssueId) {
		const result = await updateParentStatus(
			task.parentIssueId,
			task.id,
			transitions.done,
			localConfig.qa_pm_teams,
			config,
		);
		if (result.success) {
			console.log(`Linear: Parent ${task.parentIssueId} → ${transitions.done}`);
		} else if (result.unfinishedChildren?.length) {
			logParentUnchanged(task.parentIssueId, result.unfinishedChildren);
		}
	}

	return { success: true, status: transitions.done };
}

/**
 * Handle strict review completion mode
 * Mark task to dev team's testing status
 */
async function handleStrictReview(
	context: CompletionContext,
): Promise<CompletionResult> {
	const { task, config, localConfig } = context;
	const transitions = getStatusTransitions(config);

	// Get the testing status to use (from dev team)
	const devTestingStatus =
		localConfig.dev_testing_status || transitions.testing;

	if (devTestingStatus) {
		const success = await updateIssueStatus(
			task.linearId,
			devTestingStatus,
			config,
			localConfig.team,
		);
		if (success) {
			console.log(`Linear: ${task.id} → ${devTestingStatus}`);
		} else {
			return {
				success: false,
				status: task.status,
				message: `Failed to move ${task.id} to ${devTestingStatus}`,
			};
		}

		// Also mark parent to testing if exists
		if (task.parentIssueId && localConfig.qa_pm_teams?.length) {
			const result = await updateParentToTesting(
				task.parentIssueId,
				task.id,
				localConfig.qa_pm_teams,
				config,
				devTestingStatus,
			);
			if (result.success) {
				console.log(
					`Linear: Parent ${task.parentIssueId} → ${result.testingStatus}`,
				);
			} else if (result.unfinishedChildren?.length) {
				logParentUnchanged(task.parentIssueId, result.unfinishedChildren);
			}
		}

		return { success: true, status: devTestingStatus };
	}

	// Fallback to done if no testing status configured
	console.warn("No dev testing status configured, falling back to done");
	const success = await updateIssueStatus(
		task.linearId,
		transitions.done,
		config,
		localConfig.team,
	);
	if (success) {
		console.log(`Linear: ${task.id} → ${transitions.done}`);
	} else {
		return {
			success: false,
			status: task.status,
			message: `Failed to move ${task.id} to ${transitions.done}`,
		};
	}

	return { success: true, status: transitions.done };
}

/**
 * Handle upstream completion modes (upstream_strict and upstream_not_strict)
 * Mark as done, then update parent to testing
 */
export async function handleUpstreamCompletion(
	context: CompletionContext,
	isStrict: boolean,
	deps: CompletionDeps = defaultDeps,
): Promise<CompletionResult> {
	const { task, config, localConfig } = context;
	const transitions = getStatusTransitions(config);

	// Get the testing status to use (from dev team)
	const devTestingStatus =
		localConfig.dev_testing_status || transitions.testing;

	const canUpdateParent = Boolean(
		task.parentIssueId && localConfig.qa_pm_teams?.length,
	);

	// upstream_strict with nothing to hand off to ends in testing anyway, so go
	// there directly instead of writing Done and overwriting it a moment later
	if (isStrict && !canUpdateParent && devTestingStatus) {
		const reason = task.parentIssueId
			? "qa_pm_teams is not configured"
			: "no parent issue";
		const success = await deps.updateIssueStatus(
			task.linearId,
			devTestingStatus,
			config,
			localConfig.team,
		);
		if (success) {
			console.log(
				`Linear: ${task.id} → ${devTestingStatus} (${reason}; ${STRICT_FALLBACK_HINT})`,
			);
			return { success: true, status: devTestingStatus };
		}
		return {
			success: false,
			status: task.status,
			message: `Failed to move ${task.id} to ${devTestingStatus}`,
		};
	}

	// First, mark as done
	const doneSuccess = await deps.updateIssueStatus(
		task.linearId,
		transitions.done,
		config,
		localConfig.team,
	);
	if (doneSuccess) {
		console.log(`Linear: ${task.id} → ${transitions.done}`);
	}

	// Try to update parent to testing
	let parentUpdateSuccess = false;
	let parentTestingStatus: string | undefined;
	// Parent is valid but waits for its other sub-issues; it moves when the last one completes
	let parentAwaitingSiblings = false;

	if (task.parentIssueId && canUpdateParent) {
		const result = await deps.updateParentToTesting(
			task.parentIssueId,
			task.id,
			localConfig.qa_pm_teams ?? [],
			config,
			devTestingStatus,
		);
		parentUpdateSuccess = result.success;
		parentTestingStatus = result.testingStatus;

		if (parentUpdateSuccess) {
			console.log(
				`Linear: Parent ${task.parentIssueId} → ${parentTestingStatus}`,
			);
		} else if (result.unfinishedChildren?.length) {
			parentAwaitingSiblings = true;
			logParentUnchanged(task.parentIssueId, result.unfinishedChildren);
		}
	}

	// Fallback logic for upstream_strict
	if (
		isStrict &&
		!parentUpdateSuccess &&
		!parentAwaitingSiblings &&
		devTestingStatus
	) {
		// Parent could not be moved to testing, fallback to testing
		const fallbackSuccess = await deps.updateIssueStatus(
			task.linearId,
			devTestingStatus,
			config,
			localConfig.team,
		);
		if (fallbackSuccess) {
			console.log(
				`Linear: ${task.id} → ${devTestingStatus} (fallback: parent ${task.parentIssueId} could not be moved to testing - its team is not in qa_pm_teams or the update failed; ${STRICT_FALLBACK_HINT})`,
			);
			return { success: true, status: devTestingStatus };
		}
		return {
			success: false,
			status: task.status,
			message: `Failed to move ${task.id} to ${devTestingStatus}`,
		};
	}

	if (!doneSuccess) {
		return {
			success: false,
			status: task.status,
			message: `Failed to move ${task.id} to ${transitions.done}`,
		};
	}

	return { success: true, status: transitions.done };
}

/**
 * Handle Linear task completion with complex completion modes
 */
export async function handleLinearCompletion(
	context: CompletionContext,
): Promise<CompletionResult> {
	const { task, localConfig, commit, promptMessage } = context;

	// Determine completion mode
	const completionMode: CompletionMode =
		localConfig.completion_mode ||
		(localConfig.qa_pm_teams && localConfig.qa_pm_teams.length > 0
			? "upstream_strict"
			: "simple");

	let result: CompletionResult;

	// Execute based on completion mode
	switch (completionMode) {
		case "simple":
			result = await handleSimpleCompletion(context);
			break;

		case "strict_review":
			result = await handleStrictReview(context);
			break;

		case "upstream_strict":
			result = await handleUpstreamCompletion(context, true);
			break;

		case "upstream_not_strict":
			result = await handleUpstreamCompletion(context, false);
			break;

		default:
			result = await handleSimpleCompletion(context);
	}

	// Add comment with commit info (only if promptMessage provided)
	if (result.success && commit && promptMessage) {
		const commentBody = buildCompletionComment(commit, promptMessage);
		const commentSuccess = await addComment(task.linearId, commentBody);
		if (commentSuccess) {
			console.log(`Linear: 已新增 commit 留言`);
		}
	}

	return result;
}
