import prompts from "prompts";
import { PRIORITY_LABELS, displayTaskFull } from "./lib/display.js";
import { getStatusTransitions, updateIssueStatus } from "./lib/linear.js";
import {
	getPrioritySortIndex,
	loadConfig,
	loadCycleData,
	loadLocalConfig,
	saveCycleData,
} from "./utils.js";

async function workOn() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt work-on [issue-id]

Arguments:
  issue-id    Issue ID (e.g., MP-624) or 'next' for auto-select
              If omitted, shows interactive selection

Examples:
  ttt work-on           # Interactive selection
  ttt work-on MP-624    # Work on specific issue
  ttt work-on next      # Auto-select highest priority`);
		process.exit(0);
	}

	let issueId = args[0];

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
			title: `${PRIORITY_LABELS[task.priority] || "⚪"} ${task.id}: ${task.title}`,
			value: task.id,
			description: task.labels.join(", "),
		}));

		const response = await prompts({
			type: "select",
			name: "issueId",
			message: "選擇要處理的任務:",
			choices: choices,
		});

		if (!response.issueId) {
			console.log("已取消");
			process.exit(0);
		}
		issueId = response.issueId;
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
	}

	// Mark as In Progress
	if (task.localStatus === "pending") {
		task.localStatus = "in-progress";

		// Update Linear
		if (task.linearId && process.env.LINEAR_API_KEY) {
			const transitions = getStatusTransitions(config);
			const success = await updateIssueStatus(
				task.linearId,
				transitions.in_progress,
				config,
				localConfig.team,
			);
			if (success) {
				task.status = transitions.in_progress;
				console.log(`Linear: ${task.id} → ${transitions.in_progress}`);
			}
		}

		await saveCycleData(data);
		console.log(`Local: ${task.id} → in-progress`);
	}

	// Display task info
	displayTaskFull(task, "👷");
	console.log("Next: bun type-check && bun lint");
}

workOn().catch(console.error);
