#!/usr/bin/env bun
import { createAdapter } from "./lib/adapters/index.js";
import { displayTaskWithStatus, getStatusIcon } from "./lib/display.js";
import { getStatusTransitions, mapLocalStatusToLinear } from "./lib/linear.js";
import { getFirstTodoStatus } from "./lib/status-helpers.js";
import {
	type Config,
	getSourceType,
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
	"blocked",
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
                        blocked      Set to blocked (syncs to Linear if configured)
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
	let fromRemote = false;

	if (!issueId) {
		const inProgressTasks = data.tasks.filter(
			(t) => t.localStatus === "in-progress",
		);
		if (inProgressTasks.length === 0) {
			console.log("No in-progress task found.");
			console.log("\nAll tasks:");
			for (const t of data.tasks) {
				const estimate = t.estimate ? ` | ${t.estimate.hours}h` : "";
				console.log(
					`  ${getStatusIcon(t.localStatus)} ${t.id}: ${t.title} [${t.localStatus}]${estimate}`,
				);
			}
			process.exit(0);
		}
		task = inProgressTasks[0];
		issueId = task.id;
	} else {
		task = data.tasks.find((t) => t.id === issueId || t.id === `MP-${issueId}`);
		if (!task) {
			// Fetch from remote
			console.error(
				`Issue ${issueId} not in local data. Fetching from remote...`,
			);
			task = await fetchTaskFromRemote(issueId, config);
			if (!task) {
				console.error(`Issue ${issueId} not found.`);
				process.exit(1);
			}
			issueId = task.id;
			fromRemote = true;
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
			["pending", "in-progress", "completed", "blocked"].includes(setStatus)
		) {
			newLocalStatus = setStatus as Task["localStatus"];
		} else if (["todo", "in_progress", "done", "testing"].includes(setStatus)) {
			const transitions = getStatusTransitions(config);
			if (setStatus === "todo") {
				newLinearStatus = getFirstTodoStatus(transitions.todo);
				newLocalStatus = "pending";
			} else if (setStatus === "in_progress") {
				newLinearStatus = transitions.in_progress;
				newLocalStatus = "in-progress";
			} else if (setStatus === "done") {
				newLinearStatus = transitions.done;
				newLocalStatus = "completed";
			} else if (setStatus === "testing") {
				newLinearStatus = transitions.testing;
			}
		} else {
			console.error(`Unknown status: ${setStatus}`);
			process.exit(1);
		}

		// Track if we need to save
		let needsSave = false;
		const oldLocalStatus = task.localStatus;

		// Update local status
		if (newLocalStatus && newLocalStatus !== task.localStatus) {
			task.localStatus = newLocalStatus;
			needsSave = true;
		}

		// Update remote status (only if status_source is 'remote' or not set)
		const statusSource = localConfig.status_source || "remote";
		const sourceType = getSourceType(config);
		const sourceId = task.sourceId ?? task.linearId;

		if (
			statusSource === "remote" &&
			(newLinearStatus || newLocalStatus) &&
			sourceId
		) {
			let targetStateName = newLinearStatus;
			if (!targetStateName && newLocalStatus) {
				targetStateName = mapLocalStatusToLinear(newLocalStatus, config);
			}

			if (targetStateName) {
				try {
					const adapter = createAdapter(config);
					const teamId = config.teams[localConfig.team]?.id;

					if (teamId) {
						const statuses = await adapter.getStatuses(teamId);
						const targetStatus = statuses.find(
							(s) => s.name === targetStateName,
						);

						if (targetStatus) {
							const result = await adapter.updateIssueStatus(
								sourceId,
								targetStatus.id,
							);
							if (result.success) {
								task.status = targetStateName;
								needsSave = true;
								const sourceName =
									sourceType === "trello" ? "Trello" : "Linear";
								console.log(`${sourceName}: ${task.id} → ${targetStateName}`);
							}
						}
					}
				} catch (_error) {
					// Silently fail if adapter not available
				}
			}
		} else if (
			statusSource === "local" &&
			(newLinearStatus || newLocalStatus)
		) {
			// Local mode: just note that remote wasn't updated
			needsSave = true;
		}

		// Save if anything changed
		if (needsSave) {
			if (fromRemote) {
				data.tasks.push(task);
			}
			await saveCycleData(data);
			if (newLocalStatus && newLocalStatus !== oldLocalStatus) {
				console.log(`Local: ${task.id} ${oldLocalStatus} → ${newLocalStatus}`);
			}
			if (statusSource === "local") {
				const sourceName = sourceType === "trello" ? "Trello" : "Linear";
				console.log(
					`(${sourceName} status not updated - use 'sync --update' to push)`,
				);
			}
		} else if (newLocalStatus) {
			console.log(`Local: ${task.id} already ${newLocalStatus}`);
		}
	}

	// Display task info using shared function
	displayTaskWithStatus(task);
}

status().catch(console.error);
