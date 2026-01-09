#!/usr/bin/env bun
/**
 * ttt done - Complete a task
 * Entry point that delegates to source-specific completion handlers
 */

import { input, select } from "@inquirer/prompts";
import {
	type CompletionContext,
	handleLinearCompletion,
	handleTrelloCompletion,
	parseArgs,
	printHelp,
} from "./lib/done/index.js";
import { getLatestCommit } from "./lib/git.js";
import { fetchIssueDetail, syncSingleIssue } from "./lib/sync.js";
import {
	getSourceType,
	loadConfig,
	loadCycleData,
	loadLocalConfig,
	saveCycleData,
	type Task,
} from "./utils.js";

async function doneJob() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		printHelp();
		process.exit(0);
	}

	const {
		issueId: argIssueId,
		message: argMessage,
		fromRemote,
	} = parseArgs(args);
	let issueId = argIssueId;

	const config = await loadConfig();
	const localConfig = await loadLocalConfig();
	const data = await loadCycleData();

	let task: Task;

	// --from-remote mode: fetch directly from Linear
	if (fromRemote) {
		if (!issueId) {
			console.error("--from-remote requires an issue ID.");
			process.exit(1);
		}

		console.log(`Fetching ${issueId} from Linear...`);
		const remoteTask = await fetchIssueDetail(issueId);

		if (!remoteTask) {
			console.error(`Issue ${issueId} not found in Linear.`);
			process.exit(1);
		}

		// Set localStatus to in-progress for --from-remote mode
		remoteTask.localStatus = "in-progress";
		task = remoteTask;
		console.log(`Fetched: ${task.id} - ${task.title}`);
	} else {
		// Normal mode: use local data
		if (!data) {
			console.error("No cycle data found. Run 'ttt sync' first.");
			process.exit(1);
		}

		// Find in-progress tasks
		const inProgressTasks = data.tasks.filter(
			(t) => t.localStatus === "in-progress",
		);

		if (inProgressTasks.length === 0) {
			console.log("沒有進行中的任務");
			process.exit(0);
		}

		// Issue Resolution
		if (!issueId) {
			if (inProgressTasks.length === 1) {
				issueId = inProgressTasks[0].id;
				console.log(`Auto-selected: ${issueId}`);
			} else if (process.stdin.isTTY) {
				const choices = inProgressTasks.map((t) => ({
					name: `${t.id}: ${t.title}`,
					value: t.id,
					description: t.labels.join(", "),
				}));

				const selectedId = await select({
					message: "選擇要完成的任務:",
					choices: choices,
				});

				if (!selectedId) {
					console.log("已取消");
					process.exit(0);
				}
				issueId = selectedId;
			} else {
				console.error("多個進行中任務，請指定 issue ID:");
				for (const t of inProgressTasks) {
					console.log(`  - ${t.id}: ${t.title}`);
				}
				process.exit(1);
			}
		}

		// Find task in local data
		const localTask = data.tasks.find(
			(t) => t.id === issueId || t.id === `MP-${issueId}`,
		);
		if (!localTask) {
			console.error(`Issue ${issueId} not found in local data.`);
			console.error(
				`Hint: Run 'ttt sync ${issueId}' or use '--from-remote' flag.`,
			);
			process.exit(1);
		}

		if (localTask.localStatus !== "in-progress") {
			console.log(
				`⚠️ 任務 ${localTask.id} 不在進行中狀態 (目前: ${localTask.localStatus})`,
			);
			process.exit(1);
		}

		task = localTask;
	}

	// Get latest commit
	const commit = getLatestCommit();

	// Get AI summary message
	let promptMessage = argMessage || "";
	if (!promptMessage && process.stdin.isTTY) {
		promptMessage = await input({
			message: "🔧 修復說明 (如何解決此問題):",
		});
	}

	// Update remote (only if status_source is 'remote' or not set)
	const statusSource = localConfig.status_source || "remote";
	const sourceType = getSourceType(config);
	const sourceId = task.sourceId ?? task.linearId;

	if (sourceId && statusSource === "remote") {
		// Build completion context
		const context: CompletionContext = {
			task,
			config,
			localConfig,
			commit,
			promptMessage,
		};

		// Branch based on source type
		if (sourceType === "trello") {
			await handleTrelloCompletion(context);
		} else {
			await handleLinearCompletion(context);
		}
	} else if (statusSource === "local") {
		const sourceName = sourceType === "trello" ? "Trello" : "Linear";
		console.log(`Local: ${task.id} marked as completed`);
		console.log(
			`(${sourceName} status not updated - use 'sync --update' to push)`,
		);
	}

	// Sync full issue data from remote (including new comment)
	if (sourceType === "linear") {
		const syncedTask = await syncSingleIssue(task.id, {
			config,
			localConfig,
			preserveLocalStatus: false, // Let remote status determine local status
		});

		if (syncedTask) {
			console.log(
				`Synced: ${syncedTask.id} → ${syncedTask.status} (local: ${syncedTask.localStatus})`,
			);
		}
	} else {
		// For Trello, skip full sync (would require adapter-based syncSingleIssue)
		// Just update local status
		task.localStatus = "completed";
		const existingData = await loadCycleData();
		if (existingData) {
			const existingTasks = existingData.tasks.filter((t) => t.id !== task.id);
			existingData.tasks = [...existingTasks, task];
			existingData.updatedAt = new Date().toISOString();
			await saveCycleData(existingData);
			console.log(`Local: ${task.id} → completed`);
		}
	}

	// Summary
	console.log(`\n${"═".repeat(50)}`);
	console.log(`✅ ${task.id}: ${task.title}`);
	console.log(`${"═".repeat(50)}`);
	if (commit) {
		console.log(`Commit: ${commit.shortHash} - ${commit.message}`);
		if (commit.commitUrl) {
			console.log(`URL: ${commit.commitUrl}`);
		}
	}
	if (promptMessage) {
		console.log(`🔧 說明: ${promptMessage}`);
	}
	console.log(`\n🎉 任務完成！`);
}

doneJob().catch(console.error);
