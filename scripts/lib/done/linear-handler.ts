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

/**
 * Handle simple completion mode
 * Mark task as done, also mark parent as done if exists
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
	}

	// Also mark parent as done if exists
	if (task.parentIssueId) {
		const result = await updateParentStatus(
			task.parentIssueId,
			transitions.done,
			localConfig.qa_pm_teams,
			config,
		);
		if (result.success) {
			console.log(`Linear: Parent ${task.parentIssueId} → ${transitions.done}`);
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
		}

		// Also mark parent to testing if exists
		if (task.parentIssueId && localConfig.qa_pm_teams?.length) {
			const result = await updateParentToTesting(
				task.parentIssueId,
				localConfig.qa_pm_teams,
				config,
			);
			if (result.success) {
				console.log(
					`Linear: Parent ${task.parentIssueId} → ${result.testingStatus}`,
				);
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
	}

	return { success: true, status: transitions.done };
}

/**
 * Handle upstream completion modes (upstream_strict and upstream_not_strict)
 * Mark as done, then update parent to testing
 */
async function handleUpstreamCompletion(
	context: CompletionContext,
	isStrict: boolean,
): Promise<CompletionResult> {
	const { task, config, localConfig } = context;
	const transitions = getStatusTransitions(config);

	// Get the testing status to use (from dev team)
	const devTestingStatus =
		localConfig.dev_testing_status || transitions.testing;

	// First, mark as done
	const doneSuccess = await updateIssueStatus(
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

	if (task.parentIssueId && localConfig.qa_pm_teams?.length) {
		const result = await updateParentToTesting(
			task.parentIssueId,
			localConfig.qa_pm_teams,
			config,
		);
		parentUpdateSuccess = result.success;
		parentTestingStatus = result.testingStatus;

		if (parentUpdateSuccess) {
			console.log(
				`Linear: Parent ${task.parentIssueId} → ${parentTestingStatus}`,
			);
		}
	}

	// Fallback logic for upstream_strict
	if (isStrict && !parentUpdateSuccess && devTestingStatus) {
		// No parent or parent update failed, fallback to testing
		const fallbackSuccess = await updateIssueStatus(
			task.linearId,
			devTestingStatus,
			config,
			localConfig.team,
		);
		if (fallbackSuccess) {
			console.log(
				`Linear: ${task.id} → ${devTestingStatus} (fallback, no valid parent)`,
			);
		}
		return { success: true, status: devTestingStatus };
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
	if (commit && promptMessage) {
		const commentBody = buildCompletionComment(commit, promptMessage);
		const commentSuccess = await addComment(task.linearId, commentBody);
		if (commentSuccess) {
			console.log(`Linear: 已新增 commit 留言`);
		}
	}

	return result;
}
