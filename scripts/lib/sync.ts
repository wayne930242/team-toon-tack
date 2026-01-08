import type { LinearClient } from "@linear/sdk";
import {
	type Attachment,
	type Comment,
	type Config,
	type LocalConfig,
	type Task,
	getLinearClient,
	loadCycleData,
	saveCycleData,
	getPrioritySortIndex,
} from "../utils.js";
import { getStatusTransitions } from "./linear.js";

export interface SyncIssueOptions {
	config: Config;
	localConfig: LocalConfig;
	client?: LinearClient;
	preserveLocalStatus?: boolean;
}

/**
 * Sync a single issue from Linear and update local cycle data
 * Returns the updated task or null if issue not found
 */
export async function syncSingleIssue(
	issueId: string,
	options: SyncIssueOptions,
): Promise<Task | null> {
	const {
		config,
		localConfig: _localConfig,
		preserveLocalStatus = true,
	} = options;
	const client = options.client ?? getLinearClient();

	// Search for the issue
	const searchResult = await client.searchIssues(issueId);
	const matchingIssue = searchResult.nodes.find(
		(i) => i.identifier === issueId,
	);

	if (!matchingIssue) {
		console.error(`Issue ${issueId} not found in Linear.`);
		return null;
	}

	// Fetch full issue data
	const issue = await client.issue(matchingIssue.id);

	const assignee = await issue.assignee;
	const assigneeEmail = assignee?.email;

	const labels = await issue.labels();
	const labelNames = labels.nodes.map((l: { name: string }) => l.name);

	const state = await issue.state;
	const parent = await issue.parent;
	const attachmentsData = await issue.attachments();
	const commentsData = await issue.comments();

	// Build attachments list
	const attachments: Attachment[] = attachmentsData.nodes.map(
		(a: {
			id: string;
			title: string;
			url: string;
			sourceType?: string | null;
		}) => ({
			id: a.id,
			title: a.title,
			url: a.url,
			sourceType: a.sourceType ?? undefined,
		}),
	);

	// Build comments list
	const comments: Comment[] = await Promise.all(
		commentsData.nodes.map(async (c) => {
			const user = await c.user;
			return {
				id: c.id,
				body: c.body,
				createdAt: c.createdAt.toISOString(),
				user: user?.displayName ?? user?.email,
			};
		}),
	);

	// Determine local status
	let localStatus: Task["localStatus"] = "pending";
	const existingData = await loadCycleData();

	if (preserveLocalStatus && existingData) {
		const existingTask = existingData.tasks.find((t) => t.id === issueId);
		if (existingTask) {
			localStatus = existingTask.localStatus;
		}
	}

	// Map remote status to local status if not preserving
	if (!preserveLocalStatus && state) {
		const transitions = getStatusTransitions(config);
		if (state.name === transitions.done) {
			localStatus = "completed";
		} else if (state.name === transitions.in_progress) {
			localStatus = "in-progress";
		} else {
			localStatus = "pending";
		}
	}

	const task: Task = {
		id: issue.identifier,
		linearId: issue.id,
		title: issue.title,
		status: state ? state.name : "Unknown",
		localStatus: localStatus,
		assignee: assigneeEmail,
		priority: issue.priority,
		labels: labelNames,
		branch: issue.branchName,
		description: issue.description ?? undefined,
		parentIssueId: parent ? parent.identifier : undefined,
		url: issue.url,
		attachments: attachments.length > 0 ? attachments : undefined,
		comments: comments.length > 0 ? comments : undefined,
	};

	// Update cycle data
	if (existingData) {
		const existingTasks = existingData.tasks.filter((t) => t.id !== issueId);
		const finalTasks = [...existingTasks, task];

		// Sort by priority
		finalTasks.sort((a, b) => {
			const pa = getPrioritySortIndex(a.priority, config.priority_order);
			const pb = getPrioritySortIndex(b.priority, config.priority_order);
			return pa - pb;
		});

		existingData.tasks = finalTasks;
		existingData.updatedAt = new Date().toISOString();
		await saveCycleData(existingData);
	}

	return task;
}
