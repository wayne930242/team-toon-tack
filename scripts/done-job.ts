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
	getLinearClient,
	loadConfig,
	loadCycleData,
	loadLocalConfig,
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

	// Update Linear
	if (task.linearId && process.env.LINEAR_API_KEY) {
		const transitions = getStatusTransitions(config);

		// Update issue to Done
		const success = await updateIssueStatus(
			task.linearId,
			transitions.done,
			config,
			localConfig.team,
		);
		if (success) {
			console.log(`Linear: ${task.id} → ${transitions.done}`);
		}

		// Add comment with commit info
		if (commit) {
			const commentBody = buildCompletionComment(commit, aiMessage);
			const commentSuccess = await addComment(task.linearId, commentBody);
			if (commentSuccess) {
				console.log(`Linear: 已新增 commit 留言`);
			}
		}

		// Update parent to Testing if exists
		if (task.parentIssueId && transitions.testing) {
			try {
				const client = getLinearClient();
				const searchResult = await client.searchIssues(task.parentIssueId);
				const parentIssue = searchResult.nodes.find(
					(issue) => issue.identifier === task.parentIssueId,
				);

				if (parentIssue) {
					const parentTeam = await parentIssue.team;
					if (parentTeam) {
						const parentStates = await getWorkflowStates(
							config,
							localConfig.team,
						);
						const testingState = parentStates.find(
							(s) => s.name === transitions.testing,
						);

						if (testingState) {
							await client.updateIssue(parentIssue.id, {
								stateId: testingState.id,
							});
							console.log(
								`Linear: Parent ${task.parentIssueId} → ${transitions.testing}`,
							);
						}
					}
				}
			} catch (parentError) {
				console.error("Failed to update parent issue:", parentError);
			}
		}
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
	if (task.parentIssueId && config.status_transitions?.testing) {
		console.log(
			`Parent: ${task.parentIssueId} → ${config.status_transitions.testing}`,
		);
	}
	console.log(`\n🎉 任務完成！`);
}

doneJob().catch(console.error);
