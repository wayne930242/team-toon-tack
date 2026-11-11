/**
 * `ttt order close`: after the train merged, complete every in-review ticket
 * and say on each where it landed.
 *
 * A rerun continues where the last one stopped: a ticket the order already
 * marks done is skipped, a ticket already done at the source is not moved
 * again, and the comment is posted only when the ticket does not carry this
 * order's marker yet.
 */

import { type Config, getSourceType, type LocalConfig } from "../../utils.js";
import { handleCompletion } from "../done/index.js";
import { getStatusTransitions } from "../linear.js";
import { sourceIssueToTask } from "../remote-task.js";
import type { OrderRemote, TicketResult } from "./remote.js";
import type { OrderTicket, WorkOrder } from "./types.js";

/** The line that identifies this order's comment on a ticket. */
export function orderCommentMarker(orderId: string): string {
	return `**Work order:** \`${orderId}\``;
}

export function buildOrderComment(
	order: WorkOrder,
	ticket: OrderTicket,
): string {
	const lines = ["## ✅ 已合併 (Merged)", ""];
	if (ticket.mr) lines.push(`- **MR:** ${ticket.mr}`);
	if (order.train.mr) lines.push(`- **Train MR:** ${order.train.mr}`);
	lines.push(`- **Merge commit:** \`${order.train.merged_commit}\``);
	if (order.train.version) lines.push(`- **Version:** ${order.train.version}`);
	lines.push(`- ${orderCommentMarker(order.id)}`);
	return lines.join("\n");
}

export interface CloseContext {
	config: Config;
	localConfig: LocalConfig;
	remote: OrderRemote;
	dryRun: boolean;
}

/** A closed ticket: `status` is where the completion mode left it. */
export interface CloseResult extends TicketResult {
	status?: string;
}

/**
 * Complete one in-review ticket and comment on it. `order` must already
 * record the merge. Changes nothing with `dryRun`.
 */
export async function closeTicket(
	order: WorkOrder,
	ticket: OrderTicket,
	context: CloseContext,
): Promise<CloseResult> {
	const { config, localConfig, remote, dryRun } = context;
	const id = ticket.id;
	const fail = (detail: string): CloseResult => ({ id, ok: false, detail });

	try {
		const issue = await remote.adapter.searchIssue(id);
		if (!issue) return fail("not found at the source");

		const doneStatus = getStatusTransitions(config).done;
		const type = remote.statuses.find((s) => s.name === issue.status)?.type;
		if (type === "canceled") {
			return fail(
				`is ${issue.status} at the source; leave it out with 'ttt order drop ${order.id} ${id} --reason canceled'`,
			);
		}
		const alreadyDone = issue.status === doneStatus || type === "completed";
		const transitions = getStatusTransitions(config);
		// A ticket sent back to work after the seal (Todo, In Progress, Backlog,
		// Triage) is not closed. Any other open status is a review status, so a
		// ticket reviewed with `ttt order review --status <name>` still closes.
		const backStatuses = [transitions.todo, transitions.in_progress].filter(
			(s): s is string => Boolean(s),
		);
		const movedBack =
			type === "unstarted" ||
			type === "backlog" ||
			type === "triage" ||
			backStatuses.includes(issue.status);
		if (!alreadyDone && movedBack) {
			return fail(
				`is ${issue.status} at the source, no longer in review; send it back with 'ttt order review' if it is not merged yet, or leave it out with 'ttt order drop ${order.id} ${id} --reason ...'`,
			);
		}
		const commented =
			issue.comments?.some((c) =>
				c.body.includes(orderCommentMarker(order.id)),
			) ?? false;

		if (dryRun) {
			const steps = [
				alreadyDone ? "" : `complete (now ${issue.status})`,
				commented ? "" : "comment",
			].filter(Boolean);
			return {
				id,
				ok: true,
				detail:
					steps.length > 0
						? `would ${steps.join(" and ")}`
						: `already ${issue.status} and commented; would only mark it done`,
			};
		}

		let status = issue.status;
		if (!alreadyDone) {
			const task = sourceIssueToTask(issue, getSourceType(config));
			task.localStatus = "in-progress";
			// No commit or message: the order's own comment follows below
			const result = await handleCompletion({
				task,
				config,
				localConfig,
				commit: null,
				promptMessage: "",
			});
			if (!result.success) {
				return fail(result.message ?? "the status update failed");
			}
			status = result.status ?? doneStatus;
			const resultType = remote.statuses.find((s) => s.name === status)?.type;
			if (status !== doneStatus && resultType !== "completed") {
				// The completion mode handed it to testing: the train is merged, but
				// the ticket is not done, so the order must not close over it
				return fail(
					`is ${status}, not ${doneStatus}: completion_mode '${localConfig.completion_mode ?? "default"}' stops at the testing status. Move it to ${doneStatus} or set completion_mode (ttt config), then rerun 'ttt order close ${order.id}'`,
				);
			}
		}

		if (!commented) {
			const posted = await remote.adapter.addComment(
				issue.sourceId,
				buildOrderComment(order, ticket),
			);
			if (!posted.success) {
				return fail(
					`is ${status}, but the comment failed (${posted.error ?? "unknown error"}); rerun to post it`,
				);
			}
		}

		return {
			id,
			ok: true,
			status,
			detail: alreadyDone ? `already ${status}` : `→ ${status}`,
		};
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	}
}
