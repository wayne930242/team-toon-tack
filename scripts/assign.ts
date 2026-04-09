#!/usr/bin/env bun
import { select } from "@inquirer/prompts";
import { createAdapter } from "./lib/adapters/index.js";
import {
	type Config,
	getSourceType,
	getTaskSourceId,
	loadConfig,
	loadCycleData,
	saveCycleData,
	type Task,
} from "./utils.js";

function parseArgs(args: string[]): { issueId?: string; assignee?: string } {
	let issueId: string | undefined;
	let assignee: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "-a" || arg === "--assignee") {
			assignee = args[++i];
		} else if (!arg.startsWith("-") && !issueId) {
			issueId = arg;
		}
	}

	return { issueId, assignee };
}

async function findTask(
	issueId: string | undefined,
	config: Config,
): Promise<Task> {
	const cycleData = await loadCycleData();

	if (!issueId) {
		if (!cycleData) {
			console.error("No cycle data found. Run ttt sync first.");
			process.exit(1);
		}
		const inProgress = cycleData.tasks.find(
			(t) => t.localStatus === "in-progress",
		);
		if (!inProgress) {
			console.error("No in-progress task found. Specify issue ID.");
			process.exit(1);
		}
		return inProgress;
	}

	const localTask = cycleData?.tasks.find(
		(t) => t.id === issueId || t.id === issueId.toUpperCase(),
	);
	if (localTask) return localTask;

	const adapter = createAdapter(config);
	const issue = await adapter.searchIssue(issueId);
	if (!issue) {
		console.error(`Issue ${issueId} not found.`);
		process.exit(1);
	}
	const sourceType = getSourceType(config);
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
		url: issue.url,
	};
}

async function assign() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt assign [issue-id] [-a <user-key>]

Reassign an issue to a different user.

Arguments:
  issue-id                Issue ID (e.g., MP-123). If omitted, uses current task.

Options:
  -a, --assignee <key>    User key from config. If omitted, interactive select.

Examples:
  ttt assign MP-123 -a john       # Assign MP-123 to john
  ttt assign -a jane              # Assign current task to jane
  ttt assign MP-123               # Interactive assignee selection`);
		process.exit(0);
	}

	const parsed = parseArgs(args);
	const config = await loadConfig();
	const task = await findTask(parsed.issueId, config);

	let assigneeKey = parsed.assignee;
	if (!assigneeKey) {
		const choices = Object.entries(config.users).map(([key, u]) => ({
			name: `${u.displayName} (${key})`,
			value: key,
		}));
		assigneeKey = await select({
			message: `Assign ${task.id} to:`,
			choices,
		});
	}

	const user = config.users[assigneeKey];
	if (!user) {
		console.error(`User "${assigneeKey}" not found.`);
		console.error(`Available: ${Object.keys(config.users).join(", ")}`);
		process.exit(1);
	}

	const sourceId = getTaskSourceId(task);
	if (!sourceId) {
		console.error(`No source ID for ${task.id}.`);
		process.exit(1);
	}

	console.log(`Assigning ${task.id} to ${user.displayName}...`);

	const adapter = createAdapter(config);
	const result = await adapter.updateIssue(sourceId, { assigneeId: user.id });
	if (!result.success) {
		console.error(`Failed: ${result.error}`);
		process.exit(1);
	}

	console.log(`\n✅ ${task.id} assigned to ${user.displayName}`);

	const cycleData = await loadCycleData();
	if (cycleData) {
		const localTask = cycleData.tasks.find((t) => t.id === task.id);
		if (localTask) {
			localTask.assignee = user.email;
			cycleData.updatedAt = new Date().toISOString();
			await saveCycleData(cycleData);
			console.log(`   Local cache updated.`);
		}
	}
}

assign().catch(console.error);
