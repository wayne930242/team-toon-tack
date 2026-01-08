#!/usr/bin/env bun
import { displayTaskWithStatus, getStatusIcon } from "./lib/display.js";
import {
	getStatusTransitions,
	mapLocalStatusToLinear,
	updateIssueStatus,
} from "./lib/linear.js";
import {
	loadConfig,
	loadCycleData,
	loadLocalConfig,
	saveCycleData,
	type Task,
} from "./utils.js";

const LOCAL_STATUS_ORDER: Task["localStatus"][] = [
	"pending",
	"in-progress",
	"completed",
	"blocked-backend",
];

function parseArgs(args: string[]): { issueId?: string; setStatus?: string } {
	let issueId: string | undefined;
	let setStatus: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--set" || arg === "-s") {
			setStatus = args[++i];
		} else if (!arg.startsWith("-")) {
			issueId = arg;
		}
	}

	return { issueId, setStatus };
}

async function status() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt status [issue-id] [--set <status>]

Show or modify the status of an issue.

Arguments:
  issue-id              Issue ID (e.g., MP-624). If omitted, shows in-progress task.

Options:
  -s, --set <status>    Set local and Linear status. Values:
                        +1       Move to next status (pending → in-progress → completed)
                        -1       Move to previous status
                        +2       Skip two statuses forward
                        -2       Skip two statuses backward
                        pending  Set to pending
                        in-progress  Set to in-progress
                        completed    Set to completed
                        blocked      Set to blocked-backend
                        todo     Set Linear to Todo status
                        done     Set Linear to Done status

Examples:
  ttt status                    # Show current in-progress task
  ttt status MP-624             # Show status of specific issue
  ttt status MP-624 --set +1    # Move to next status
  ttt status --set pending      # Reset current task to pending`);
		process.exit(0);
	}

	const { issueId: argIssueId, setStatus } = parseArgs(args);
	const config = await loadConfig();
	const localConfig = await loadLocalConfig();
	const data = await loadCycleData();

	if (!data) {
		console.error("No cycle data found. Run ttt sync first.");
		process.exit(1);
	}

	// Find task
	let task: Task | undefined;
	let issueId = argIssueId;

	if (!issueId) {
		const inProgressTasks = data.tasks.filter(
			(t) => t.localStatus === "in-progress",
		);
		if (inProgressTasks.length === 0) {
			console.log("No in-progress task found.");
			console.log("\nAll tasks:");
			for (const t of data.tasks) {
				console.log(
					`  ${getStatusIcon(t.localStatus)} ${t.id}: ${t.title} [${t.localStatus}]`,
				);
			}
			process.exit(0);
		}
		task = inProgressTasks[0];
		issueId = task.id;
	} else {
		task = data.tasks.find((t) => t.id === issueId || t.id === `MP-${issueId}`);
		if (!task) {
			console.error(`Issue ${issueId} not found in local data.`);
			process.exit(1);
		}
	}

	// If setting status
	if (setStatus) {
		const currentIndex = LOCAL_STATUS_ORDER.indexOf(task.localStatus);
		let newLocalStatus: Task["localStatus"] | undefined;
		let newLinearStatus: string | undefined;

		// Parse status change
		if (setStatus === "+1") {
			const newIndex = Math.min(
				currentIndex + 1,
				LOCAL_STATUS_ORDER.length - 1,
			);
			newLocalStatus = LOCAL_STATUS_ORDER[newIndex];
		} else if (setStatus === "-1") {
			const newIndex = Math.max(currentIndex - 1, 0);
			newLocalStatus = LOCAL_STATUS_ORDER[newIndex];
		} else if (setStatus === "+2") {
			const newIndex = Math.min(
				currentIndex + 2,
				LOCAL_STATUS_ORDER.length - 1,
			);
			newLocalStatus = LOCAL_STATUS_ORDER[newIndex];
		} else if (setStatus === "-2") {
			const newIndex = Math.max(currentIndex - 2, 0);
			newLocalStatus = LOCAL_STATUS_ORDER[newIndex];
		} else if (
			[
				"pending",
				"in-progress",
				"completed",
				"blocked-backend",
				"blocked",
			].includes(setStatus)
		) {
			newLocalStatus =
				setStatus === "blocked"
					? "blocked-backend"
					: (setStatus as Task["localStatus"]);
		} else if (["todo", "in_progress", "done", "testing"].includes(setStatus)) {
			const transitions = getStatusTransitions(config);
			newLinearStatus =
				transitions[setStatus as keyof typeof transitions] ?? undefined;

			if (setStatus === "todo") {
				newLocalStatus = "pending";
			} else if (setStatus === "in_progress") {
				newLocalStatus = "in-progress";
			} else if (setStatus === "done") {
				newLocalStatus = "completed";
			}
		} else {
			console.error(`Unknown status: ${setStatus}`);
			process.exit(1);
		}

		// Update local status
		if (newLocalStatus && newLocalStatus !== task.localStatus) {
			const oldStatus = task.localStatus;
			task.localStatus = newLocalStatus;
			await saveCycleData(data);
			console.log(`Local: ${task.id} ${oldStatus} → ${newLocalStatus}`);
		}

		// Update Linear status
		if (newLinearStatus || newLocalStatus) {
			let targetStateName = newLinearStatus;
			if (!targetStateName && newLocalStatus) {
				targetStateName = mapLocalStatusToLinear(newLocalStatus, config);
			}

			if (targetStateName) {
				const success = await updateIssueStatus(
					task.linearId,
					targetStateName,
					config,
					localConfig.team,
				);
				if (success) {
					console.log(`Linear: ${task.id} → ${targetStateName}`);
				}
			}
		}
	}

	// Display task info using shared function
	displayTaskWithStatus(task);
}

status().catch(console.error);
