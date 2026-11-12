#!/usr/bin/env bun
/**
 * ttt done - Complete one or more tasks
 * Entry point that delegates to source-specific completion handlers
 */
import { input, select } from "@inquirer/prompts";
import { createAdapter } from "./lib/adapters/index.js";
import {
	type CompletionResult,
	handleCompletion,
	parseArgs,
	printHelp,
} from "./lib/done/index.js";
import {
	describeNotInProgress,
	syncUntilStatus,
} from "./lib/done/status-check.js";
import { type CommitInfo, getLatestCommit } from "./lib/git.js";
import { getStatusTransitions } from "./lib/linear.js";
import { sourceIssueToTask } from "./lib/remote-task.js";
import { fetchIssueDetail, syncSingleIssue } from "./lib/sync.js";
import {
	type Config,
	type CycleData,
	findTaskByIssueId,
	getSourceName,
	getSourceType,
	type LocalConfig,
	loadConfig,
	loadCycleData,
	loadLocalConfig,
	saveCycleData,
	type Task,
} from "./utils.js";

/** What `ttt done` did with one requested ticket. */
type DoneOutcome =
	| { id: string; kind: "done"; task: Task; status?: string }
	| { id: string; kind: "already-done"; status: string }
	| { id: string; kind: "failed"; reason: string };

interface DoneRun {
	config: Config;
	localConfig: LocalConfig;
	data: CycleData | null;
	fromRemote: boolean;
	commit: CommitInfo | null;
	promptMessage: string;
}

function failed(id: string, reason: string): DoneOutcome {
	console.error(reason);
	return { id, kind: "failed", reason };
}

/** Pick the ticket when no ID was given: the only in-progress one, or ask. */
async function pickInProgressTask(data: CycleData): Promise<string> {
	const inProgressTasks = data.tasks.filter(
		(t) => t.localStatus === "in-progress",
	);

	if (inProgressTasks.length === 0) {
		console.log("沒有進行中的任務");
		process.exit(0);
	}

	if (inProgressTasks.length === 1) {
		console.log(`Auto-selected: ${inProgressTasks[0].id}`);
		return inProgressTasks[0].id;
	}

	if (process.stdin.isTTY) {
		const selectedId = await select({
			message: "選擇要完成的任務:",
			choices: inProgressTasks.map((t) => ({
				name: `${t.id}: ${t.title}`,
				value: t.id,
				description: t.labels.join(", "),
			})),
		});

		if (!selectedId) {
			console.log("已取消");
			process.exit(0);
		}
		return selectedId;
	}

	console.error("多個進行中任務，請指定 issue ID:");
	for (const t of inProgressTasks) {
		console.log(`  - ${t.id}: ${t.title}`);
	}
	process.exit(1);
}

/**
 * The status the completion mode moves a ticket to, when it is not the done
 * status: strict_review stops at testing. (upstream_strict also stops there
 * when the parent cannot take it; that is not known before the run.)
 */
function completionTarget(
	config: Config,
	localConfig: LocalConfig,
): string | undefined {
	if (getSourceType(config) !== "linear") return undefined;
	if (localConfig.completion_mode !== "strict_review") return undefined;
	return localConfig.dev_testing_status || getStatusTransitions(config).testing;
}

/** Linear goes through the full issue sync; other sources through their adapter. */
async function fetchFromSource(
	issueId: string,
	config: Config,
): Promise<Task | null> {
	if (getSourceType(config) === "linear") return fetchIssueDetail(issueId);
	const issue = await createAdapter(config).searchIssue(issueId);
	return issue ? sourceIssueToTask(issue, getSourceType(config)) : null;
}

/**
 * Find the ticket to complete. A ticket that is already done is reported, not
 * completed again, so a batch can be rerun after a partial failure.
 */
async function resolveTask(
	issueId: string,
	run: Pick<DoneRun, "config" | "localConfig" | "data" | "fromRemote">,
): Promise<{ task: Task } | { outcome: DoneOutcome }> {
	const doneStatus = getStatusTransitions(run.config).done;
	const target = completionTarget(run.config, run.localConfig);

	// --from-remote mode: fetch directly from the source
	if (run.fromRemote) {
		const sourceName = getSourceName(run.config);
		console.log(`Fetching ${issueId} from ${sourceName}...`);
		const remoteTask = await fetchFromSource(issueId, run.config);

		if (!remoteTask) {
			return {
				outcome: failed(
					issueId,
					`Issue ${issueId} not found in ${sourceName}.`,
				),
			};
		}
		if (remoteTask.status === doneStatus || remoteTask.status === target) {
			return {
				outcome: {
					id: remoteTask.id,
					kind: "already-done",
					status: remoteTask.status,
				},
			};
		}

		// Set localStatus to in-progress for --from-remote mode
		remoteTask.localStatus = "in-progress";
		console.log(`Fetched: ${remoteTask.id} - ${remoteTask.title}`);
		return { task: remoteTask };
	}

	// Normal mode: use local data
	const localTask = run.data
		? findTaskByIssueId(run.data.tasks, issueId)
		: undefined;
	if (!localTask) {
		return {
			outcome: failed(
				issueId,
				`Issue ${issueId} not found in local data.\nHint: Run 'ttt sync ${issueId}' or use '--from-remote' flag.`,
			),
		};
	}
	if (localTask.localStatus === "completed" || localTask.status === target) {
		return {
			outcome: {
				id: localTask.id,
				kind: "already-done",
				status: localTask.status,
			},
		};
	}
	if (localTask.localStatus !== "in-progress") {
		return { outcome: failed(localTask.id, describeNotInProgress(localTask)) };
	}
	return { task: localTask };
}

async function completeTask(task: Task, run: DoneRun): Promise<DoneOutcome> {
	const { config, localConfig, commit, promptMessage } = run;

	// Update remote (only if status_source is 'remote' or not set)
	const statusSource = localConfig.status_source || "remote";
	const sourceType = getSourceType(config);
	const sourceId = task.sourceId ?? task.linearId;
	let completionResult: CompletionResult | null = null;

	if (sourceId && statusSource === "remote") {
		completionResult = await handleCompletion({
			task,
			config,
			localConfig,
			commit,
			promptMessage,
		});

		if (!completionResult.success) {
			return failed(
				task.id,
				completionResult.message ||
					`Failed to update remote status for ${task.id}.`,
			);
		}
	} else if (statusSource === "local") {
		const sourceName = getSourceName(config);
		console.log(`Local: ${task.id} marked as completed`);
		console.log(
			`(${sourceName} status not updated - use 'sync --update' to push)`,
		);
	}

	// Sync full issue data from remote (including new comment)
	if (sourceType === "linear") {
		// Let remote status determine local status; wait out read-after-write lag
		// so a stale read is not recorded as the local state
		const syncedTask = await syncUntilStatus(
			() =>
				syncSingleIssue(task.id, {
					config,
					localConfig,
					preserveLocalStatus: false,
				}),
			completionResult?.status,
		);
		if (syncedTask) {
			console.log(
				`Synced: ${syncedTask.id} → ${syncedTask.status} (local: ${syncedTask.localStatus})`,
			);
			if (
				completionResult?.status &&
				syncedTask.status !== completionResult.status
			) {
				return failed(
					task.id,
					`Remote status verification failed for ${task.id}: expected ${completionResult.status}, got ${syncedTask.status}. Another actor (e.g. a Git integration or automation) may have changed it; check the issue in Linear.`,
				);
			}
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

	return { id: task.id, kind: "done", task, status: completionResult?.status };
}

function describeOutcome(outcome: DoneOutcome): string {
	switch (outcome.kind) {
		case "done":
			return `✅ ${outcome.id} → ${outcome.status ?? "completed"}`;
		case "already-done":
			return `⏭️ ${outcome.id} already ${outcome.status} (skipped)`;
		case "failed":
			return `❌ ${outcome.id} failed: ${outcome.reason.split("\n")[0]}`;
	}
}

function printSingleSummary(
	task: Task,
	commit: CommitInfo | null,
	promptMessage: string,
): void {
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

async function doneJob() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		printHelp();
		process.exit(0);
	}

	const {
		issueIds: argIssueIds,
		message: argMessage,
		fromRemote,
		commit: commitRef,
		repo,
	} = parseArgs(args);

	const config = await loadConfig();
	const localConfig = await loadLocalConfig();
	const data = await loadCycleData();

	let issueIds = argIssueIds;
	if (fromRemote) {
		if (issueIds.length === 0) {
			console.error("--from-remote requires an issue ID.");
			process.exit(1);
		}
	} else {
		if (!data) {
			console.error("No cycle data found. Run 'ttt sync' first.");
			process.exit(1);
		}
		if (issueIds.length === 0) {
			issueIds = [await pickInProgressTask(data)];
		}
	}

	// Get the commit to record: HEAD by default, or the one named with --commit
	const commit = getLatestCommit({ ref: commitRef, cwd: repo });
	if ((commitRef || repo) && !commit) {
		console.error(
			`Cannot read commit ${commitRef ?? "HEAD"} from ${repo ?? "the current directory"}. Nothing was changed.`,
		);
		process.exit(1);
	}

	// Resolve every ticket before asking for a message or changing anything.
	// `outcomes` keeps the order the tickets were given in.
	const outcomes: DoneOutcome[] = [];
	const pending: { index: number; task: Task }[] = [];
	for (const [index, issueId] of issueIds.entries()) {
		const resolved = await resolveTask(issueId, {
			config,
			localConfig,
			data,
			fromRemote,
		});
		if ("task" in resolved) pending.push({ index, task: resolved.task });
		else outcomes[index] = resolved.outcome;
	}
	// A wrong ID in the batch stops it before any ticket moves
	const unresolved = outcomes.filter((o) => o?.kind === "failed");
	if (unresolved.length > 0) {
		console.error(
			`Cannot complete ${unresolved.map((o) => o.id).join(", ")}. Nothing was changed.`,
		);
		process.exit(1);
	}

	// Get AI summary message, shared by every ticket in the run
	let promptMessage = argMessage || "";
	if (pending.length > 0 && !promptMessage && process.stdin.isTTY) {
		promptMessage = await input({
			message: "🔧 修復說明 (如何解決此問題):",
		});
	}

	// One failing ticket must not stop the rest of the batch
	const run: DoneRun = {
		config,
		localConfig,
		data,
		fromRemote,
		commit,
		promptMessage,
	};
	for (const { index, task } of pending) {
		try {
			outcomes[index] = await completeTask(task, run);
		} catch (error) {
			outcomes[index] = failed(
				task.id,
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	if (outcomes.length === 1) {
		const [outcome] = outcomes;
		if (outcome.kind === "done") {
			printSingleSummary(outcome.task, commit, promptMessage);
		} else if (outcome.kind === "already-done") {
			console.log(describeOutcome(outcome));
		}
	} else {
		console.log(`\n${"═".repeat(50)}`);
		for (const outcome of outcomes) {
			console.log(describeOutcome(outcome));
		}
		const count = (kind: DoneOutcome["kind"]) =>
			outcomes.filter((o) => o.kind === kind).length;
		console.log(
			`\nDone: ${count("done")}, already done: ${count("already-done")}, failed: ${count("failed")}`,
		);
	}

	if (outcomes.some((o) => o.kind === "failed")) {
		process.exit(1);
	}
}

doneJob().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
