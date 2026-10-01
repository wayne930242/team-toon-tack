/**
 * Guards and post-update checks for `ttt done`
 */

import type { Task } from "../../utils.js";

/**
 * Explain why a task cannot be completed from its local status, and what to
 * do instead. `ttt done` completes in-progress work only, so the guard stays;
 * the message names the two ways forward.
 */
export function describeNotInProgress(task: Pick<Task, "id" | "localStatus">) {
	const lines = [`⚠️ 任務 ${task.id} 不在進行中狀態 (目前: ${task.localStatus})`];

	if (task.localStatus === "completed" || task.localStatus === "in-review") {
		lines.push(
			`   已經完成或送審；若要再次執行完成流程，請用 'ttt done ${task.id} --from-remote'。`,
		);
	} else {
		lines.push(
			`   - 'ttt claim ${task.id}' 先領取（Linear 會多一次 In Progress 轉換），或`,
			`   - 'ttt done ${task.id} --from-remote' 直接從 Linear 完成（不需要先 claim）。`,
		);
	}

	return lines.join("\n");
}

export interface SyncUntilStatusOptions {
	attempts?: number;
	delayMs?: number;
	sleep?: (ms: number) => Promise<void>;
}

/**
 * Sync a task until the remote reports the status we just wrote. Linear reads
 * can lag a write by a moment; syncing once would record the stale status
 * as the local state and then report a false mismatch.
 */
export async function syncUntilStatus(
	sync: () => Promise<Task | null>,
	expectedStatus: string | undefined,
	options: SyncUntilStatusOptions = {},
): Promise<Task | null> {
	const {
		attempts = 4,
		delayMs = 1000,
		sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	} = options;

	let task = await sync();
	for (
		let attempt = 1;
		task && expectedStatus && task.status !== expectedStatus && attempt < attempts;
		attempt++
	) {
		await sleep(delayMs);
		task = await sync();
	}
	return task;
}
