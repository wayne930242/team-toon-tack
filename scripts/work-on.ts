import { select } from "@inquirer/prompts";
import { createAdapter } from "./lib/adapters/index.js";
import { displayTaskFull, PRIORITY_LABELS } from "./lib/display.js";
import { getStatusTransitions } from "./lib/linear.js";
import {
	getPrioritySortIndex,
	getSourceType,
	loadConfig,
	loadCycleData,
	loadLocalConfig,
	saveCycleData,
} from "./utils.js";

async function workOn() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt work-on [issue-id] [options]

Arguments:
  issue-id    Issue ID (e.g., MP-624) or 'next' for auto-select
              If omitted, shows interactive selection

Options:
  --dry-run   Pick task without changing status (preview only)

Examples:
  ttt work-on           # Interactive selection
  ttt work-on MP-624    # Work on specific issue
  ttt work-on next      # Auto-select highest priority
  ttt work-on --dry-run # Preview selection without changes`);
		process.exit(0);
	}

	const dryRun = args.includes("--dry-run");
	const filteredArgs = args.filter((a) => a !== "--dry-run");
	let issueId = filteredArgs[0];

	const config = await loadConfig();
	const data = await loadCycleData();

	if (!data) {
		console.error("No cycle data found. Run /sync-linear first.");
		process.exit(1);
	}

	const localConfig = await loadLocalConfig();

	// Get current user email for filtering
	const currentUserEmail = config.users[localConfig.current_user]?.email;

	const pendingTasks = data.tasks
		.filter(
			(t) =>
				t.localStatus === "pending" &&
				(!currentUserEmail || t.assignee === currentUserEmail),
		)
		.sort((a, b) => {
			const pa = getPrioritySortIndex(a.priority, config.priority_order);
			const pb = getPrioritySortIndex(b.priority, config.priority_order);
			return pa - pb;
		});

	// Issue Resolution
	if (!issueId) {
		if (pendingTasks.length === 0) {
			console.log("✅ 沒有待處理的任務，所有工作已完成或進行中");
			process.exit(0);
		}

		const choices = pendingTasks.map((task) => ({
			name: `${PRIORITY_LABELS[task.priority] || "⚪"} ${task.id}: ${task.title}`,
			value: task.id,
			description: task.labels.join(", "),
		}));

		const selectedId = await select({
			message: "選擇要處理的任務:",
			choices: choices,
		});

		if (!selectedId) {
			console.log("已取消");
			process.exit(0);
		}
		issueId = selectedId;
	} else if (["next", "下一個", "下一個工作"].includes(issueId)) {
		if (pendingTasks.length === 0) {
			console.log("✅ 沒有待處理的任務，所有工作已完成或進行中");
			process.exit(0);
		}
		issueId = pendingTasks[0].id;
		console.log(`Auto-selected: ${issueId}`);
	}

	// Find task
	const task = data.tasks.find(
		(t) => t.id === issueId || t.id === `MP-${issueId}`,
	);
	if (!task) {
		console.error(`Issue ${issueId} not found in current cycle.`);
		process.exit(1);
	}

	// Availability Check
	if (task.localStatus === "in-progress") {
		console.log(`⚠️ 此任務 ${task.id} 已在進行中`);
	} else if (task.localStatus === "completed") {
		console.log(`⚠️ 此任務 ${task.id} 已完成`);
		process.exit(0);
	} else if (task.localStatus === "in-review") {
		console.log(`⚠️ 此任務 ${task.id} 正在審核中`);
		process.exit(0);
	}

	// Mark as In Progress (skip if dry-run)
	if (task.localStatus === "pending" && !dryRun) {
		task.localStatus = "in-progress";

		// Update remote (only if status_source is 'remote' or not set)
		const statusSource = localConfig.status_source || "remote";
		const sourceType = getSourceType(config);
		const sourceId = task.sourceId ?? task.linearId;

		if (statusSource === "remote" && sourceId) {
			const transitions = getStatusTransitions(config);

			try {
				const adapter = createAdapter(config);

				// Get statuses to find status ID
				const teamId = config.teams[localConfig.team]?.id;
				if (teamId) {
					const statuses = await adapter.getStatuses(teamId);
					const targetStatus = statuses.find(
						(s) => s.name === transitions.in_progress,
					);

					if (targetStatus) {
						const result = await adapter.updateIssueStatus(
							sourceId,
							targetStatus.id,
						);
						if (result.success) {
							task.status = transitions.in_progress;
							const sourceName = sourceType === "trello" ? "Trello" : "Linear";
							console.log(
								`${sourceName}: ${task.id} → ${transitions.in_progress}`,
							);
						}
					}
				}
			} catch (_error) {
				// Silently fail if adapter not available (e.g., no API key)
			}
		}

		await saveCycleData(data);
		console.log(`Local: ${task.id} → in-progress`);
		if (statusSource === "local") {
			const sourceName = sourceType === "trello" ? "Trello" : "Linear";
			console.log(
				`(${sourceName} status not updated - use 'sync --update' to push)`,
			);
		}
	}

	// Display task info
	const icon = dryRun ? "🔍" : "👷";
	displayTaskFull(task, icon);
	if (dryRun) {
		console.log("(dry-run: no changes made)");
	} else {
		console.log("Next: bun type-check && bun lint");
	}
}

workOn().catch(console.error);
