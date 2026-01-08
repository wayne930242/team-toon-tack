#!/usr/bin/env bun
import {
	getLinearClient,
	getTeamId,
	loadConfig,
	loadCycleData,
	loadLocalConfig,
	saveCycleData,
	type Task,
} from "./utils.js";

const PRIORITY_LABELS: Record<number, string> = {
	0: "⚪ None",
	1: "🔴 Urgent",
	2: "🟠 High",
	3: "🟡 Medium",
	4: "🟢 Low",
};

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

	// Handle help flag
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
  ttt status MP-624 --set done  # Mark as done
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
		// Find current in-progress task
		const inProgressTasks = data.tasks.filter(
			(t) => t.localStatus === "in-progress",
		);
		if (inProgressTasks.length === 0) {
			console.log("No in-progress task found.");
			console.log("\nAll tasks:");
			for (const t of data.tasks) {
				const statusIcon =
					t.localStatus === "completed"
						? "✅"
						: t.localStatus === "in-progress"
							? "🔄"
							: t.localStatus === "blocked-backend"
								? "🚫"
								: "📋";
				console.log(`  ${statusIcon} ${t.id}: ${t.title} [${t.localStatus}]`);
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
			// Map to Linear status
			const statusTransitions = config.status_transitions || {
				todo: "Todo",
				in_progress: "In Progress",
				done: "Done",
				testing: "Testing",
			};
			newLinearStatus =
				statusTransitions[setStatus as keyof typeof statusTransitions];

			// Also update local status accordingly
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
			try {
				const client = getLinearClient();
				const teamId = getTeamId(config, localConfig.team);
				const workflowStates = await client.workflowStates({
					filter: { team: { id: { eq: teamId } } },
				});

				let targetStateName = newLinearStatus;
				if (!targetStateName && newLocalStatus) {
					// Map local status to Linear status
					const statusTransitions = config.status_transitions || {
						todo: "Todo",
						in_progress: "In Progress",
						done: "Done",
					};
					if (newLocalStatus === "pending") {
						targetStateName = statusTransitions.todo;
					} else if (newLocalStatus === "in-progress") {
						targetStateName = statusTransitions.in_progress;
					} else if (newLocalStatus === "completed") {
						targetStateName = statusTransitions.done;
					}
				}

				if (targetStateName) {
					const targetState = workflowStates.nodes.find(
						(s) => s.name === targetStateName,
					);
					if (targetState) {
						await client.updateIssue(task.linearId, {
							stateId: targetState.id,
						});
						console.log(`Linear: ${task.id} → ${targetStateName}`);
					}
				}
			} catch (e) {
				console.error("Failed to update Linear:", e);
			}
		}
	}

	// Display task info
	console.log(`\n${"═".repeat(50)}`);
	const statusIcon =
		task.localStatus === "completed"
			? "✅"
			: task.localStatus === "in-progress"
				? "🔄"
				: task.localStatus === "blocked-backend"
					? "🚫"
					: "📋";
	console.log(`${statusIcon} ${task.id}: ${task.title}`);
	console.log(`${"═".repeat(50)}`);

	console.log(`\nStatus:`);
	console.log(`  Local: ${task.localStatus}`);
	console.log(`  Linear: ${task.status}`);
	console.log(`\nInfo:`);
	console.log(`  Priority: ${PRIORITY_LABELS[task.priority] || "None"}`);
	console.log(`  Labels: ${task.labels.join(", ")}`);
	console.log(`  Assignee: ${task.assignee || "Unassigned"}`);
	console.log(`  Branch: ${task.branch || "N/A"}`);
	if (task.url) console.log(`  URL: ${task.url}`);

	if (task.description) {
		console.log(`\n📝 Description:\n${task.description}`);
	}

	if (task.attachments && task.attachments.length > 0) {
		console.log(`\n📎 Attachments:`);
		for (const att of task.attachments) {
			console.log(`   - ${att.title}: ${att.url}`);
		}
	}

	if (task.comments && task.comments.length > 0) {
		console.log(`\n💬 Comments (${task.comments.length}):`);
		for (const comment of task.comments) {
			const date = new Date(comment.createdAt).toLocaleDateString();
			console.log(`\n   [${comment.user || "Unknown"} - ${date}]`);
			const lines = comment.body.split("\n");
			for (const line of lines) {
				console.log(`   ${line}`);
			}
		}
	}

	console.log(`\n${"─".repeat(50)}`);
}

status().catch(console.error);
