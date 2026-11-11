/**
 * What work order commands do at the task source (Linear/Trello) and in the
 * local cycle data. Order files are not touched here.
 */

import {
	type Config,
	findTaskByIssueId,
	getSourceType,
	type LocalConfig,
	loadCycleData,
	saveCycleData,
	type Task,
} from "../../utils.js";
import {
	createAdapter,
	type SourceStatus,
	type TaskSourceAdapter,
} from "../adapters/index.js";
import { getStatusTransitions } from "../linear.js";
import { mapRemoteToLocalStatus } from "../status-helpers.js";
import { OrderError } from "./types.js";

export interface OrderRemote {
	adapter: TaskSourceAdapter;
	statuses: SourceStatus[];
	sourceName: string;
}

/** Outcome of one ticket in a batch command. */
export interface TicketResult {
	id: string;
	ok: boolean;
	detail: string;
}

export function sourceNameOf(config: Config): string {
	return getSourceType(config) === "trello" ? "Trello" : "Linear";
}

/** True when commands change the source; false keeps them local-only. */
export function writesRemote(localConfig: LocalConfig): boolean {
	return (localConfig.status_source || "remote") === "remote";
}

export async function connectRemote(
	config: Config,
	localConfig: LocalConfig,
): Promise<OrderRemote> {
	const teamId = config.teams[localConfig.team]?.id;
	if (!teamId) {
		throw new OrderError(
			`Team "${localConfig.team}" from local.toon is not in config.toon; run 'ttt init' or fix the team key.`,
		);
	}
	const adapter = createAdapter(config);
	return {
		adapter,
		statuses: await adapter.getStatuses(teamId),
		sourceName: sourceNameOf(config),
	};
}

/** The status `ttt order review` moves tickets to. */
export function resolveReviewStatus(
	config: Config,
	localConfig: LocalConfig,
	override?: string,
): string {
	const name =
		override ??
		getStatusTransitions(config).testing ??
		localConfig.dev_testing_status;
	if (!name) {
		throw new OrderError(
			"No testing status is configured. Set one with 'ttt config status' (status_transitions.testing) or pass --status <name>.",
		);
	}
	return name;
}

/**
 * Move tickets to `statusName` at the source. Only the status changes, so the
 * assignee stays. One failing ticket does not stop the others.
 */
export async function moveToStatus(
	ticketIds: string[],
	statusName: string,
	remote: OrderRemote,
	localTasks: Task[],
): Promise<TicketResult[]> {
	const status = remote.statuses.find((s) => s.name === statusName);
	if (!status) {
		throw new OrderError(
			`Status "${statusName}" does not exist at the source. Available: ${remote.statuses.map((s) => s.name).join(", ")}.`,
		);
	}

	const results: TicketResult[] = [];
	for (const id of ticketIds) {
		try {
			// Read the current status: the local copy may be stale
			const issue = await remote.adapter.searchIssue(id);
			const local = findTaskByIssueId(localTasks, id);
			const sourceId = issue?.sourceId ?? local?.sourceId ?? local?.linearId;
			if (!issue || !sourceId) {
				results.push({ id, ok: false, detail: "not found at the source" });
				continue;
			}
			const type = remote.statuses.find((s) => s.name === issue.status)?.type;
			if (type === "completed" || type === "canceled") {
				// Never reopen a closed ticket by sending it to review
				results.push({
					id,
					ok: false,
					detail: `is ${issue.status} at the source; reopen it there first, or drop it from the order`,
				});
				continue;
			}
			const update = await remote.adapter.updateIssueStatus(
				sourceId,
				status.id,
			);
			results.push(
				update.success
					? { id, ok: true, detail: `→ ${statusName}` }
					: { id, ok: false, detail: update.error ?? "status update failed" },
			);
		} catch (error) {
			results.push({
				id,
				ok: false,
				detail: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return results;
}

/**
 * Mirror new statuses into cycle.toon for the tickets it holds. `statusName`
 * null means the source was not written (status_source: local): only the
 * local status moves.
 */
export async function recordLocalStatuses(
	updates: Map<string, string | null>,
	localStatus: Task["localStatus"],
	config: Config,
	localConfig: LocalConfig,
): Promise<void> {
	if (updates.size === 0) return;
	const data = await loadCycleData();
	if (!data) return;

	let changed = false;
	for (const [id, statusName] of updates) {
		const task = findTaskByIssueId(data.tasks, id);
		if (!task) continue;
		if (statusName === null) {
			task.localStatus = localStatus;
		} else {
			task.status = statusName;
			task.localStatus = mapRemoteToLocalStatus(
				statusName,
				getStatusTransitions(config),
				localConfig,
			);
		}
		changed = true;
	}
	if (changed) {
		data.updatedAt = new Date().toISOString();
		await saveCycleData(data);
	}
}
