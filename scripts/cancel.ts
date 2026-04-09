#!/usr/bin/env bun
import { confirm } from "@inquirer/prompts";
import { createAdapter } from "./lib/adapters/index.js";
import {
	getTaskSourceId,
	loadConfig,
	loadCycleData,
	removeTaskFromCycleData,
} from "./utils.js";

async function cancel() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt cancel <issue-id> [--yes]

Cancel an issue (moves to Cancelled status in Linear).

Arguments:
  issue-id    Issue ID (e.g., MP-123)

Options:
  -y, --yes   Skip confirmation prompt

Examples:
  ttt cancel MP-123         # Cancel with confirmation
  ttt cancel MP-123 --yes   # Cancel without confirmation`);
		process.exit(0);
	}

	const issueId = args.find((a) => !a.startsWith("-"));
	const skipConfirm = args.includes("-y") || args.includes("--yes");

	if (!issueId) {
		console.error("Issue ID is required. Usage: ttt cancel <issue-id>");
		process.exit(1);
	}

	const config = await loadConfig();
	const cycleData = await loadCycleData();

	const task = cycleData?.tasks.find(
		(t) => t.id === issueId || t.id === issueId.toUpperCase(),
	);

	const displayId = task?.id ?? issueId;
	const displayTitle = task ? ` (${task.title})` : "";

	if (!skipConfirm) {
		const ok = await confirm({
			message: `Cancel ${displayId}${displayTitle}?`,
			default: false,
		});
		if (!ok) {
			console.log("Aborted.");
			process.exit(0);
		}
	}

	let sourceId: string | undefined;
	const adapter = createAdapter(config);

	if (task) {
		sourceId = getTaskSourceId(task);
	} else {
		const issue = await adapter.searchIssue(issueId);
		if (!issue) {
			console.error(`Issue ${issueId} not found.`);
			process.exit(1);
		}
		sourceId = issue.sourceId;
	}

	if (!sourceId) {
		console.error(`No source ID for ${displayId}.`);
		process.exit(1);
	}

	console.log(`Cancelling ${displayId}...`);
	const result = await adapter.cancelIssue(sourceId);
	if (!result.success) {
		console.error(`Failed: ${result.error}`);
		process.exit(1);
	}

	console.log(`\n✅ ${displayId} cancelled.`);

	if (cycleData) {
		await removeTaskFromCycleData(displayId, cycleData);
		console.log(`   Removed from local cycle data.`);
	}
}

cancel().catch(console.error);
