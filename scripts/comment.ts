#!/usr/bin/env bun
import { createAdapter } from "./lib/adapters/index.js";
import {
	type Config,
	getSourceType,
	loadConfig,
	loadCycleData,
	loadLocalConfig,
	type Task,
} from "./utils.js";

function parseArgs(args: string[]): { issueId?: string; message?: string } {
	let issueId: string | undefined;
	let message: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "-m" || arg === "--message") {
			message = args[++i];
		} else if (!arg.startsWith("-")) {
			issueId = arg;
		}
	}

	return { issueId, message };
}

async function fetchTaskFromRemote(
	issueId: string,
	config: Config,
): Promise<Task | undefined> {
	const adapter = createAdapter(config);
	const sourceType = getSourceType(config);
	const issue = await adapter.searchIssue(issueId);
	if (!issue) return undefined;

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
	};
}

async function comment() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt comment [issue-id] -m <message>

Add a comment to a Linear/Trello issue.

Arguments:
  issue-id              Issue ID (e.g., MP-624). If omitted, uses current in-progress task.

Options:
  -m, --message <text>  Comment message (required)

Examples:
  ttt comment MP-624 -m "Fixed the layout bug"
  ttt comment -m "Still investigating"           # Comments on current task`);
		process.exit(0);
	}

	const { issueId: argIssueId, message } = parseArgs(args);

	if (!message) {
		console.error("Message is required. Use -m <message>");
		process.exit(1);
	}

	const config = await loadConfig();
	const data = await loadCycleData();

	// Find task
	let task: Task | undefined;
	let issueId = argIssueId;

	if (!issueId) {
		if (!data) {
			console.error("No cycle data found. Run ttt sync first.");
			process.exit(1);
		}
		const inProgressTask = data.tasks.find(
			(t) => t.localStatus === "in-progress",
		);
		if (!inProgressTask) {
			console.error("No in-progress task found. Specify issue ID explicitly.");
			process.exit(1);
		}
		task = inProgressTask;
		issueId = task.id;
	} else {
		task = data?.tasks.find(
			(t) => t.id === issueId || t.id === `MP-${issueId}`,
		);
		if (!task) {
			console.error(
				`Issue ${issueId} not in local data. Fetching from remote...`,
			);
			task = await fetchTaskFromRemote(issueId, config);
			if (!task) {
				console.error(`Issue ${issueId} not found.`);
				process.exit(1);
			}
			issueId = task.id;
		}
	}

	const sourceId = task.sourceId ?? task.linearId;
	if (!sourceId) {
		console.error(`No source ID found for ${issueId}.`);
		process.exit(1);
	}

	const adapter = createAdapter(config);
	const result = await adapter.addComment(sourceId, message);

	if (result.success) {
		const sourceType = getSourceType(config);
		const sourceName = sourceType === "trello" ? "Trello" : "Linear";
		console.log(`${sourceName}: Comment added to ${issueId}`);
	} else {
		console.error(`Failed to add comment: ${result.error}`);
		process.exit(1);
	}
}

comment().catch(console.error);
