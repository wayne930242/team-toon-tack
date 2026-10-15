import type { Task } from "../utils.js";
import type { SourceIssue, TaskSourceType } from "./adapters/index.js";

/** Build a local Task from an issue fetched live from the source. */
export function sourceIssueToTask(
	issue: SourceIssue,
	sourceType: TaskSourceType,
): Task {
	return {
		id: issue.id,
		linearId: issue.sourceId,
		sourceId: issue.sourceId,
		sourceType,
		title: issue.title,
		status: issue.status,
		localStatus: "pending",
		assignee: issue.assigneeEmail,
		priority: issue.priority,
		labels: issue.labels,
		description: issue.description,
		parentIssueId: issue.parentIssueId,
		url: issue.url,
		attachments: issue.attachments?.map((a) => ({
			id: a.id,
			title: a.title,
			url: a.url,
			sourceType: a.sourceType,
		})),
		comments: issue.comments?.map((c) => ({
			id: c.id,
			body: c.body,
			createdAt: c.createdAt,
			user: c.user,
		})),
	};
}
