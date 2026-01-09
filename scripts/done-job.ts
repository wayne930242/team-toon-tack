import prompts from "prompts";
import { buildCompletionComment, getLatestCommit } from "./lib/git.js";
import {
	addComment,
	getStatusTransitions,
	getWorkflowStates,
	updateIssueStatus,
} from "./lib/linear.js";
import { syncSingleIssue } from "./lib/sync.js";
import {
	type CompletionMode,
	type Config,
	getLinearClient,
	loadConfig,
	loadCycleData,
	loadLocalConfig,
	type QaPmTeamConfig,
} from "./utils.js";

// Helper function to update parent issue to a specific status
async function updateParentStatus(
	parentIssueId: string,
	targetStatus: string,
	_qaPmTeams: QaPmTeamConfig[] | undefined,
	config: Config,
): Promise<{ success: boolean; status?: string }> {
	try {
		const client = getLinearClient();
		const searchResult = await client.searchIssues(parentIssueId);
		const parentIssue = searchResult.nodes.find(
			(issue) => issue.identifier === parentIssueId,
		);

		if (!parentIssue) {
			return { success: false };
		}

		const parentTeam = await parentIssue.team;
		if (!parentTeam) {
			return { success: false };
		}

		// Find the matching team configuration
		const teamEntries = Object.entries(config.teams);
		const matchingTeamEntry = teamEntries.find(
			([_, t]) => t.id === parentTeam.id,
		);

		if (!matchingTeamEntry) {
			return { success: false };
		}

		const [parentTeamKey] = matchingTeamEntry;

		// Get workflow states for the parent's team
		const parentStates = await getWorkflowStates(config, parentTeamKey);
		const targetState = parentStates.find((s) => s.name === targetStatus);

		if (!targetState) {
			return { success: false };
		}

		// Update the parent issue
		await client.updateIssue(parentIssue.id, {
			stateId: targetState.id,
		});

		return { success: true, status: targetStatus };
	} catch (error) {
		console.error("Failed to update parent issue:", error);
		return { success: false };
	}
}

// Helper function to update parent issue to testing status (uses QA team config)
async function updateParentToTesting(
	parentIssueId: string,
	qaPmTeams: QaPmTeamConfig[],
	config: Config,
): Promise<{ success: boolean; testingStatus?: string }> {
	try {
		const client = getLinearClient();
		const searchResult = await client.searchIssues(parentIssueId);
		const parentIssue = searchResult.nodes.find(
			(issue) => issue.identifier === parentIssueId,
		);

		if (!parentIssue) {
			return { success: false };
		}

		const parentTeam = await parentIssue.team;
		if (!parentTeam) {
			return { success: false };
		}

		// Find the matching QA/PM team configuration
		const teamEntries = Object.entries(config.teams);
		const matchingTeamEntry = teamEntries.find(
			([_, t]) => t.id === parentTeam.id,
		);

		if (!matchingTeamEntry) {
			return { success: false };
		}

		const [parentTeamKey] = matchingTeamEntry;

		// Find the QA/PM team config for this parent's team
		const qaPmConfig = qaPmTeams.find((qp) => qp.team === parentTeamKey);

		if (!qaPmConfig) {
			// Parent's team is not in the configured QA/PM teams
			return { success: false };
		}

		// Get workflow states for the parent's team
		const parentStates = await getWorkflowStates(config, parentTeamKey);
		const testingState = parentStates.find(
			(s) => s.name === qaPmConfig.testing_status,
		);

		if (!testingState) {
			return { success: false };
		}

		// Update the parent issue
		await client.updateIssue(parentIssue.id, {
			stateId: testingState.id,
		});

		return { success: true, testingStatus: qaPmConfig.testing_status };
	} catch (error) {
		console.error("Failed to update parent issue:", error);
		return { success: false };
	}
}

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

async function doneJob() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt done [issue-id] [-m message]

Arguments:
  issue-id          Issue ID (e.g., MP-624). Optional if only one task is in-progress

Options:
  -m, --message     AI summary message describing the fix

Examples:
  ttt done                         # Complete current in-progress task
  ttt done MP-624                  # Complete specific task
  ttt done -m "Fixed null check"   # With completion message
  ttt done MP-624 -m "Refactored"  # Specific task with message`);
		process.exit(0);
	}

	const { issueId: argIssueId, message: argMessage } = parseArgs(args);
	let issueId = argIssueId;

	const config = await loadConfig();
	const localConfig = await loadLocalConfig();
	const data = await loadCycleData();

	if (!data) {
		console.error("No cycle data found. Run /sync-linear first.");
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
			const choices = inProgressTasks.map((task) => ({
				title: `${task.id}: ${task.title}`,
				value: task.id,
				description: task.labels.join(", "),
			}));

			const response = await prompts({
				type: "select",
				name: "issueId",
				message: "選擇要完成的任務:",
				choices: choices,
			});

			if (!response.issueId) {
				console.log("已取消");
				process.exit(0);
			}
			issueId = response.issueId;
		} else {
			console.error("多個進行中任務，請指定 issue ID:");
			for (const t of inProgressTasks) {
				console.log(`  - ${t.id}: ${t.title}`);
			}
			process.exit(1);
		}
	}

	// Find task
	const task = data.tasks.find(
		(t) => t.id === issueId || t.id === `MP-${issueId}`,
	);
	if (!task) {
		console.error(`Issue ${issueId} not found in current cycle.`);
		process.exit(1);
	}

	if (task.localStatus !== "in-progress") {
		console.log(`⚠️ 任務 ${task.id} 不在進行中狀態 (目前: ${task.localStatus})`);
		process.exit(1);
	}

	// Get latest commit
	const commit = getLatestCommit();

	// Get AI summary message
	let aiMessage = argMessage || "";
	if (!aiMessage && process.stdin.isTTY) {
		const aiMsgResponse = await prompts({
			type: "text",
			name: "aiMessage",
			message: "AI 修復說明 (如何解決此問題):",
		});
		aiMessage = aiMsgResponse.aiMessage || "";
	}

	// Update Linear (only if status_source is 'remote' or not set)
	const statusSource = localConfig.status_source || "remote";
	if (
		task.linearId &&
		process.env.LINEAR_API_KEY &&
		statusSource === "remote"
	) {
		const transitions = getStatusTransitions(config);

		// Determine completion mode
		const completionMode: CompletionMode =
			localConfig.completion_mode ||
			(localConfig.qa_pm_teams && localConfig.qa_pm_teams.length > 0
				? "upstream_strict"
				: "simple");

		// Get the testing status to use (from dev team)
		const devTestingStatus =
			localConfig.dev_testing_status || transitions.testing;

		// Execute based on completion mode
		let parentUpdateSuccess = false;
		let parentTestingStatus: string | undefined;

		switch (completionMode) {
			case "simple": {
				// Mark task as done
				const success = await updateIssueStatus(
					task.linearId,
					transitions.done,
					config,
					localConfig.team,
				);
				if (success) {
					console.log(`Linear: ${task.id} → ${transitions.done}`);
				}
				// Also mark parent as done if exists
				if (task.parentIssueId) {
					const result = await updateParentStatus(
						task.parentIssueId,
						transitions.done,
						localConfig.qa_pm_teams,
						config,
					);
					if (result.success) {
						console.log(
							`Linear: Parent ${task.parentIssueId} → ${transitions.done}`,
						);
					}
				}
				break;
			}

			case "strict_review": {
				// Mark task to dev team's testing status
				if (devTestingStatus) {
					const success = await updateIssueStatus(
						task.linearId,
						devTestingStatus,
						config,
						localConfig.team,
					);
					if (success) {
						console.log(`Linear: ${task.id} → ${devTestingStatus}`);
					}
					// Also mark parent to testing if exists
					if (task.parentIssueId && localConfig.qa_pm_teams?.length) {
						const result = await updateParentToTesting(
							task.parentIssueId,
							localConfig.qa_pm_teams,
							config,
						);
						if (result.success) {
							console.log(
								`Linear: Parent ${task.parentIssueId} → ${result.testingStatus}`,
							);
						}
					}
				} else {
					console.warn(
						"No dev testing status configured, falling back to done",
					);
					const success = await updateIssueStatus(
						task.linearId,
						transitions.done,
						config,
						localConfig.team,
					);
					if (success) {
						console.log(`Linear: ${task.id} → ${transitions.done}`);
					}
				}
				break;
			}

			case "upstream_strict":
			case "upstream_not_strict": {
				// First, mark as done
				const doneSuccess = await updateIssueStatus(
					task.linearId,
					transitions.done,
					config,
					localConfig.team,
				);
				if (doneSuccess) {
					console.log(`Linear: ${task.id} → ${transitions.done}`);
				}

				// Try to update parent to testing
				if (task.parentIssueId && localConfig.qa_pm_teams?.length) {
					const result = await updateParentToTesting(
						task.parentIssueId,
						localConfig.qa_pm_teams,
						config,
					);
					parentUpdateSuccess = result.success;
					parentTestingStatus = result.testingStatus;

					if (parentUpdateSuccess) {
						console.log(
							`Linear: Parent ${task.parentIssueId} → ${parentTestingStatus}`,
						);
					}
				}

				// Fallback logic for upstream_strict
				if (
					completionMode === "upstream_strict" &&
					!parentUpdateSuccess &&
					devTestingStatus
				) {
					// No parent or parent update failed, fallback to testing
					const fallbackSuccess = await updateIssueStatus(
						task.linearId,
						devTestingStatus,
						config,
						localConfig.team,
					);
					if (fallbackSuccess) {
						console.log(
							`Linear: ${task.id} → ${devTestingStatus} (fallback, no valid parent)`,
						);
					}
				}
				break;
			}
		}

		// Add comment with commit info
		if (commit) {
			const commentBody = buildCompletionComment(commit, aiMessage);
			const commentSuccess = await addComment(task.linearId, commentBody);
			if (commentSuccess) {
				console.log(`Linear: 已新增 commit 留言`);
			}
		}
	} else if (statusSource === "local") {
		console.log(`Local: ${task.id} marked as completed`);
		console.log(`(Linear status not updated - use 'sync --update' to push)`);
	}

	// Sync full issue data from Linear (including new comment)
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
	if (aiMessage) {
		console.log(`AI: ${aiMessage}`);
	}
	console.log(`\n🎉 任務完成！`);
}

doneJob().catch(console.error);
