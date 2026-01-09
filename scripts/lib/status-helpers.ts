/**
 * Helper functions for status transitions
 * Handles the case where `todo` can be string | string[]
 */

import type { StatusTransitions } from "../utils.js";

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
 * Map remote status to local status using transitions
 */
export function mapRemoteToLocalStatus(
	remoteStatus: string,
	transitions: StatusTransitions,
): "pending" | "in-progress" | "completed" | "in-review" | "blocked" {
	if (remoteStatus === transitions.done) {
		return "completed";
	}
	if (remoteStatus === transitions.in_progress) {
		return "in-progress";
	}
	if (transitions.testing && remoteStatus === transitions.testing) {
		return "in-review";
	}
	if (transitions.blocked && remoteStatus === transitions.blocked) {
		return "blocked";
	}
	return "pending";
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
