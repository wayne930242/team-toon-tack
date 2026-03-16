/**
 * Helper functions for status transitions
 * Handles the case where `todo` can be string | string[]
 */

import type { LocalConfig, StatusTransitions, Task } from "../utils.js";

/**
 * Normalize todo status value to array
 * Only `todo` supports multiple values for sync filtering
 */
export function normalizeTodoStatuses(
	todo: string | string[] | undefined,
): string[] {
	if (!todo) return [];
	return Array.isArray(todo) ? todo : [todo];
}

/**
 * Check if a status name matches the todo transition (supports string | string[])
 */
export function isTodoStatus(
	statusName: string,
	transitions: StatusTransitions,
): boolean {
	const todoStatuses = normalizeTodoStatuses(transitions.todo);
	return todoStatuses.includes(statusName);
}

/**
 * Get all statuses to sync (flattens todo array + in_progress)
 */
export function getSyncStatuses(transitions: StatusTransitions): string[] {
	return [...normalizeTodoStatuses(transitions.todo), transitions.in_progress];
}

/**
 * Collect all statuses that should be treated as "in review"
 * This includes the generic testing transition plus any team-specific testing
 * statuses chosen during init/config.
 */
export function getReviewStatuses(
	transitions: StatusTransitions,
	localConfig?: LocalConfig,
): string[] {
	const statuses = new Set<string>();

	if (transitions.testing) {
		statuses.add(transitions.testing);
	}

	if (localConfig?.dev_testing_status) {
		statuses.add(localConfig.dev_testing_status);
	}

	for (const team of localConfig?.qa_pm_teams ?? []) {
		if (team.testing_status) {
			statuses.add(team.testing_status);
		}
	}

	return [...statuses];
}

/**
 * Map remote status to local status using transitions
 */
export function mapRemoteToLocalStatus(
	remoteStatus: string,
	transitions: StatusTransitions,
	localConfig?: LocalConfig,
): "pending" | "in-progress" | "completed" | "in-review" | "blocked" {
	if (remoteStatus === transitions.done) {
		return "completed";
	}
	if (remoteStatus === transitions.in_progress) {
		return "in-progress";
	}
	if (getReviewStatuses(transitions, localConfig).includes(remoteStatus)) {
		return "in-review";
	}
	if (transitions.blocked && remoteStatus === transitions.blocked) {
		return "blocked";
	}
	return "pending";
}

/**
 * Preserve optimistic local progress for active tasks, but let explicit
 * remote review/completed/blocked states override stale local state.
 */
export function resolveLocalStatus(
	existingLocalStatus: Task["localStatus"] | undefined,
	remoteStatus: string,
	transitions: StatusTransitions,
	localConfig?: LocalConfig,
): Task["localStatus"] {
	const remoteLocalStatus = mapRemoteToLocalStatus(
		remoteStatus,
		transitions,
		localConfig,
	);

	if (!existingLocalStatus) {
		return remoteLocalStatus;
	}

	if (
		remoteLocalStatus === "in-review" ||
		remoteLocalStatus === "completed" ||
		remoteLocalStatus === "blocked"
	) {
		return remoteLocalStatus;
	}

	return existingLocalStatus;
}

/**
 * Format todo status for display (handles string | string[])
 */
export function formatTodoStatus(todo: string | string[]): string {
	return Array.isArray(todo) ? todo.join(", ") : todo;
}

/**
 * Get first todo status (for defaults and pushing to remote)
 */
export function getFirstTodoStatus(
	todo: string | string[] | undefined,
): string | undefined {
	if (!todo) return undefined;
	return Array.isArray(todo) ? todo[0] : todo;
}
