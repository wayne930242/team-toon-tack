import { checkbox } from "@inquirer/prompts";
import type { SourceStatus, TaskSourceAdapter } from "./lib/adapters/index.js";
import { createAdapter } from "./lib/adapters/index.js";
import { displayTaskFull, PRIORITY_LABELS } from "./lib/display.js";
import { getStatusTransitions } from "./lib/linear.js";
import { sourceIssueToTask } from "./lib/remote-task.js";
import { mapRemoteToLocalStatus } from "./lib/status-helpers.js";
import {
	type Config,
	type CycleData,
	findTaskByIssueId,
	getPrioritySortIndex,
	getSourceType,
	type LocalConfig,
	loadConfig,
	loadCycleData,
	loadLocalConfig,
	saveCycleData,
	type Task,
} from "./utils.js";

const NEXT_ALIASES = ["next", "下一個", "下一個工作"];
const NO_PENDING_MESSAGE = "✅ 沒有待處理的任務，所有工作已完成或進行中";

const HELP = `Usage: ttt claim [issue-id...] [options]

Claim ticket(s): move them to in-progress locally and on the remote source.
Alias: ttt work-on

Arguments:
  issue-id    One or more issue IDs (e.g., MP-624 MP-625)
              'next' claims the highest priority pending task
              'next <n>' claims the top <n> pending tasks
              If omitted, shows interactive multi-select
              An ID missing from local data (e.g. a Backlog ticket outside
              the cycle) is fetched from the source, stored locally, and
              claimed like any other

Options:
  --dry-run   Pick tickets without changing status (preview only)

Examples:
  ttt claim                     # Interactive multi-select
  ttt claim MP-624              # Claim one ticket
  ttt claim MP-624 MP-625       # Claim several tickets at once
  ttt claim next                # Claim highest priority pending task
  ttt claim next 3              # Claim top 3 pending tasks
  ttt claim --dry-run           # Preview without changes`;

/** What `claim` decided to do with one requested ticket. */
interface ClaimOutcome {
	task: Task;
	action: "claim" | "already-in-progress" | "skip";
}

function pickTasks(
	outcomes: ClaimOutcome[],
	match: (action: ClaimOutcome["action"]) => boolean,
): Task[] {
	return outcomes.filter((o) => match(o.action)).map((o) => o.task);
}

/** Pending tasks assigned to the current user, highest priority first. */
function getPendingTasks(
	data: CycleData,
	config: Config,
	localConfig: LocalConfig,
): Task[] {
	const userKeys = Array.isArray(localConfig.current_user)
		? localConfig.current_user
		: localConfig.current_user
			? [localConfig.current_user]
			: [];
	const currentUserEmails = userKeys
		.map((key) => config.users[key]?.email?.toLowerCase())
		.filter((email): email is string => !!email);

	return data.tasks
		.filter((t) => {
			if (t.localStatus !== "pending") return false;
			if (currentUserEmails.length === 0) return true; // No filter = all users
			if (!t.assignee) return false;
			return currentUserEmails.includes(t.assignee.toLowerCase());
		})
		.sort((a, b) => {
			const pa = getPrioritySortIndex(a.priority, config.priority_order);
			const pb = getPrioritySortIndex(b.priority, config.priority_order);
			return pa - pb;
		});
}

async function selectInteractively(pendingTasks: Task[]): Promise<string[]> {
	if (pendingTasks.length === 0) {
		console.log(NO_PENDING_MESSAGE);
		process.exit(0);
	}

	const selected = await checkbox({
		message: "選擇要領的票 (空白鍵多選, Enter 確認):",
		choices: pendingTasks.map((task) => ({
			name: `${PRIORITY_LABELS[task.priority] || "⚪"} ${task.id}: ${task.title}`,
			value: task.id,
			description: task.labels.join(", "),
		})),
	});

	if (selected.length === 0) {
		console.log("已取消");
		process.exit(0);
	}
	return selected;
}

function selectNext(
	countArg: string | undefined,
	pendingTasks: Task[],
): string[] {
	const count = countArg ? Number.parseInt(countArg, 10) : 1;
	if (!Number.isInteger(count) || count < 1) {
		console.error(`Invalid count: ${countArg}`);
		process.exit(1);
	}
	if (pendingTasks.length === 0) {
		console.log(NO_PENDING_MESSAGE);
		process.exit(0);
	}
	const ids = pendingTasks.slice(0, count).map((t) => t.id);
	console.log(`Auto-selected: ${ids.join(", ")}`);
	return ids;
}

/**
 * Fetch a ticket that local data does not hold. Returns null when the source
 * is unreachable or has no such ticket; the caller aborts the batch.
 */
async function fetchRemoteTask(
	issueId: string,
	config: Config,
	localConfig: LocalConfig,
): Promise<Task | null> {
	try {
		const adapter = createAdapter(config);
		const issue = await adapter.searchIssue(issueId);
		if (!issue) return null;
		const task = sourceIssueToTask(issue, getSourceType(config));
		task.localStatus = mapRemoteToLocalStatus(
			task.status,
			getStatusTransitions(config),
			localConfig,
		);
		// Closed states are named per team ("Canceled", "Duplicate", ...), so
		// the configured done name alone misses them; the state type does not.
		const teamId = config.teams[localConfig.team]?.id;
		if (task.localStatus === "pending" && teamId) {
			const statuses = await adapter.getStatuses(teamId);
			const type = statuses.find((s) => s.name === task.status)?.type;
			if (type === "completed" || type === "canceled") {
				task.localStatus = "completed";
			}
		}
		return task;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Could not look up ${issueId} remotely: ${message}`);
		return null;
	}
}

/**
 * Resolve the requested tickets, exiting if any ID is unknown both locally
 * and at the source. `fetched` holds the tickets that came from the source so
 * the caller can store them once it knows they will be claimed.
 */
async function resolveTasks(
	data: CycleData,
	issueIds: string[],
	config: Config,
	localConfig: LocalConfig,
): Promise<{ tasks: Task[]; fetched: Set<Task> }> {
	const tasks: Task[] = [];
	const fetched = new Set<Task>();
	const missing: string[] = [];

	for (const issueId of issueIds) {
		const local = findTaskByIssueId(data.tasks, issueId);
		if (local) {
			tasks.push(local);
			continue;
		}
		const remote = await fetchRemoteTask(issueId, config, localConfig);
		if (remote) {
			tasks.push(remote);
			fetched.add(remote);
		} else {
			missing.push(issueId);
		}
	}

	if (missing.length > 0) {
		console.error(
			`Issue ${missing.join(", ")} not found in local data or at the source (use the full ID, e.g. MP-123). No ticket claimed.`,
		);
		process.exit(1);
	}
	return { tasks, fetched };
}

function decide(task: Task): ClaimOutcome {
	switch (task.localStatus) {
		case "pending":
			return { task, action: "claim" };
		case "in-progress":
			console.log(`⚠️ 此任務 ${task.id} 已在進行中`);
			return { task, action: "already-in-progress" };
		case "completed":
			console.log(`⚠️ 此任務 ${task.id} 已完成`);
			return { task, action: "skip" };
		case "in-review":
			console.log(`⚠️ 此任務 ${task.id} 正在審核中`);
			return { task, action: "skip" };
		case "blocked":
			console.log(`⚠️ 此任務 ${task.id} 已被阻擋`);
			return { task, action: "skip" };
	}
}

/**
 * Resolve the remote target status once for the whole batch.
 * Returns null when the source is unreachable or not configured, which keeps
 * claiming local-only (e.g. no API key).
 */
async function resolveRemoteTarget(
	config: Config,
	teamId: string | undefined,
	inProgressStatus: string,
): Promise<{ adapter: TaskSourceAdapter; status: SourceStatus } | null> {
	if (!teamId) return null;
	try {
		const adapter = createAdapter(config);
		const statuses = await adapter.getStatuses(teamId);
		const status = statuses.find((s) => s.name === inProgressStatus);
		return status ? { adapter, status } : null;
	} catch {
		return null;
	}
}

/**
 * Push one ticket to the remote in-progress status. One failing ticket must not
 * abort the batch, and a local/remote divergence has to stay visible.
 */
async function pushRemoteStatus(
	remote: { adapter: TaskSourceAdapter; status: SourceStatus },
	task: Task,
	statusName: string,
	sourceName: string,
): Promise<void> {
	const sourceId = task.sourceId ?? task.linearId;
	if (!sourceId) return;

	try {
		const result = await remote.adapter.updateIssueStatus(
			sourceId,
			remote.status.id,
		);
		if (result.success) {
			task.status = statusName;
			console.log(`${sourceName}: ${task.id} → ${statusName}`);
		} else {
			console.log(
				`⚠️ ${sourceName}: ${task.id} 未更新 (${result.error ?? "unknown error"})`,
			);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.log(`⚠️ ${sourceName}: ${task.id} 未更新 (${message})`);
	}
}

async function applyClaims(
	toClaim: Task[],
	data: CycleData,
	config: Config,
	localConfig: LocalConfig,
): Promise<void> {
	const statusSource = localConfig.status_source || "remote";
	const sourceName = getSourceType(config) === "trello" ? "Trello" : "Linear";
	const transitions = getStatusTransitions(config);
	const remote =
		statusSource === "remote"
			? await resolveRemoteTarget(
					config,
					config.teams[localConfig.team]?.id,
					transitions.in_progress,
				)
			: null;

	for (const task of toClaim) {
		if (remote) {
			await pushRemoteStatus(remote, task, transitions.in_progress, sourceName);
		}
		task.localStatus = "in-progress";
		console.log(`Local: ${task.id} → in-progress`);
	}

	await saveCycleData(data);

	if (statusSource === "local") {
		console.log(
			`(${sourceName} status not updated - use 'sync --update' to push)`,
		);
	}
}

async function resolveIssueIds(
	positional: string[],
	pendingTasks: Task[],
): Promise<string[]> {
	if (positional.length === 0) return selectInteractively(pendingTasks);
	if (NEXT_ALIASES.includes(positional[0])) {
		return selectNext(positional[1], pendingTasks);
	}
	return [...new Set(positional)];
}

async function claim() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(HELP);
		process.exit(0);
	}

	const dryRun = args.includes("--dry-run");
	const positional = args.filter((a) => a !== "--dry-run");

	const config = await loadConfig();
	const data = await loadCycleData();

	if (!data) {
		console.error("No cycle data found. Run /sync-linear first.");
		process.exit(1);
	}

	const localConfig = await loadLocalConfig();
	const pendingTasks = getPendingTasks(data, config, localConfig);

	const issueIds = await resolveIssueIds(positional, pendingTasks);

	// Availability Check — resolve the whole batch before mutating anything
	const resolved = await resolveTasks(data, issueIds, config, localConfig);
	const outcomes = resolved.tasks.map(decide);
	const toClaim = pickTasks(outcomes, (a) => a === "claim");
	const toDisplay = pickTasks(outcomes, (a) => a !== "skip");

	if (toDisplay.length === 0) {
		process.exit(0);
	}

	// Fetched tickets are stored when they are claimed or already in progress,
	// so a later `ttt done` finds them; a dry run or a skipped ticket leaves
	// local data untouched.
	if (!dryRun) {
		const toStore = outcomes
			.filter((o) => resolved.fetched.has(o.task) && o.action !== "skip")
			.map((o) => o.task);
		data.tasks.push(...toStore);

		if (toClaim.length > 0) {
			await applyClaims(toClaim, data, config, localConfig);
		} else if (toStore.length > 0) {
			await saveCycleData(data);
		}
	}

	// Display task info
	const icon = dryRun ? "🔍" : "👷";
	for (const task of toDisplay) {
		displayTaskFull(task, icon);
	}

	if (dryRun) {
		console.log("(dry-run: no changes made)");
	} else {
		console.log("Next: bun type-check && bun lint");
	}
}

claim().catch(console.error);
