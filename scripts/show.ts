import { createAdapter } from "./lib/adapters/index.js";
import {
	displayTaskFull,
	getStatusIcon,
	PRIORITY_LABELS,
} from "./lib/display.js";
import { getStatusTransitions } from "./lib/linear.js";
import { getSyncStatuses } from "./lib/status-helpers.js";
import {
	getSourceType,
	getUserEmails,
	loadConfig,
	loadCycleData,
	loadLocalConfig,
	type Task,
} from "./utils.js";

interface SearchFilters {
	label?: string;
	status?: string;
	assignee?: string;
	priority?: number;
}

function taskToMarkdown(task: Task): string {
	const lines: string[] = [];
	const priority = PRIORITY_LABELS[task.priority] || "None";

	lines.push(`## ${task.id}: ${task.title}`);
	lines.push("");
	lines.push(`- **Status**: ${task.status} (Local: ${task.localStatus})`);
	lines.push(`- **Priority**: ${priority}`);
	lines.push(
		`- **Labels**: ${task.labels.length > 0 ? task.labels.join(", ") : "-"}`,
	);
	lines.push(`- **Assignee**: ${task.assignee || "Unassigned"}`);
	if (task.estimate) {
		const note = task.estimate.note ? ` (${task.estimate.note})` : "";
		lines.push(`- **Estimate**: ${task.estimate.hours}h${note}`);
	}
	if (task.url) lines.push(`- **URL**: ${task.url}`);
	if (task.parentIssueId) lines.push(`- **Parent**: ${task.parentIssueId}`);

	if (task.description) {
		lines.push("");
		lines.push("### Description");
		lines.push("");
		lines.push(task.description);
	}

	if (task.attachments && task.attachments.length > 0) {
		lines.push("");
		lines.push("### Attachments");
		lines.push("");
		for (const att of task.attachments) {
			const path = att.localPath || att.url;
			lines.push(`- ${att.title}: ${path}`);
		}
	}

	if (task.comments && task.comments.length > 0) {
		lines.push("");
		lines.push("### Comments");
		for (const comment of task.comments) {
			const date = new Date(comment.createdAt).toLocaleDateString();
			lines.push("");
			lines.push(`**${comment.user || "Unknown"}** - ${date}`);
			lines.push("");
			lines.push(comment.body);
		}
	}

	return lines.join("\n");
}

function tasksToMarkdownList(tasks: Task[]): string {
	if (tasks.length === 0) {
		return "No issues found.";
	}

	const lines: string[] = [];
	lines.push(`# Issues (${tasks.length})`);
	lines.push("");

	for (const task of tasks) {
		const icon = getStatusIcon(task.localStatus);
		const priority = PRIORITY_LABELS[task.priority] || "None";
		const assignee = task.assignee ? task.assignee.split("@")[0] : "unassigned";

		lines.push(`## ${icon} ${task.id}: ${task.title}`);
		lines.push("");
		lines.push(`| Field | Value |`);
		lines.push(`|-------|-------|`);
		lines.push(`| Status | ${task.status} |`);
		lines.push(`| Priority | ${priority} |`);
		lines.push(`| Assignee | ${assignee} |`);
		if (task.estimate) {
			const note = task.estimate.note ? ` (${task.estimate.note})` : "";
			lines.push(`| Estimate | ${task.estimate.hours}h${note} |`);
		}
		lines.push(
			`| Labels | ${task.labels.length > 0 ? task.labels.join(", ") : "-"} |`,
		);
		if (task.url) lines.push(`| URL | ${task.url} |`);
		lines.push("");
	}

	return lines.join("\n");
}

function displayTaskList(tasks: Task[]): void {
	if (tasks.length === 0) {
		console.log("No issues found.");
		return;
	}

	console.log(`\nFound ${tasks.length} issue(s):\n`);
	console.log("─".repeat(80));

	for (const task of tasks) {
		const icon = getStatusIcon(task.localStatus);
		const priority = PRIORITY_LABELS[task.priority] || "⚪ None";
		const assignee = task.assignee ? task.assignee.split("@")[0] : "unassigned";
		const labels = task.labels.length > 0 ? task.labels.join(", ") : "-";
		const estimate = task.estimate
			? ` | Estimate: ${task.estimate.hours}h`
			: "";

		console.log(`${icon} ${task.id}: ${task.title}`);
		console.log(
			`   Status: ${task.status} | Priority: ${priority} | Assignee: ${assignee}${estimate}`,
		);
		console.log(`   Labels: ${labels}`);
		console.log("─".repeat(80));
	}
}

async function fetchIssueFromRemote(issueId: string): Promise<Task | null> {
	const config = await loadConfig();
	const adapter = createAdapter(config);
	const sourceType = getSourceType(config);

	const issue = await adapter.searchIssue(issueId);
	if (!issue) {
		return null;
	}

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

/**
 * How `--user` narrows a search. The default scope is the configured
 * `current_user` — the same set `ttt sync` writes into the local cache — so
 * both search paths start from the same universe. An explicit `--user` other
 * than "me" overrides that scope rather than narrowing within it, which is
 * what makes `--user <someone-else> --remote` still useful.
 */
type AssigneeScope =
	| { kind: "user"; emails: string[] }
	| { kind: "unassigned" }
	| { kind: "match"; needle: string }
	| { kind: "any" };

function resolveAssigneeScope(
	requested: string | undefined,
	userEmails: string[],
): AssigneeScope {
	const emails = userEmails.map((e) => e.toLowerCase());
	const value = requested?.toLowerCase();

	if (!value || value === "me") {
		return emails.length > 0 ? { kind: "user", emails } : { kind: "any" };
	}
	if (value === "unassigned") {
		return { kind: "unassigned" };
	}
	return { kind: "match", needle: value };
}

/** True when the scope reaches outside what `ttt sync` stored locally. */
function scopeEscapesLocalCache(
	scope: AssigneeScope,
	userEmails: string[],
): boolean {
	return userEmails.length > 0 && scope.kind !== "user";
}

function matchesAssignee(task: Task, scope: AssigneeScope): boolean {
	switch (scope.kind) {
		case "user":
			return (
				!!task.assignee && scope.emails.includes(task.assignee.toLowerCase())
			);
		case "unassigned":
			return !task.assignee;
		case "match":
			return !!task.assignee?.toLowerCase().includes(scope.needle);
		case "any":
			return true;
	}
}

/** Shared by both search paths so local and --remote filter identically. */
function applyFilters(
	tasks: Task[],
	filters: SearchFilters,
	scope: AssigneeScope,
): Task[] {
	return tasks.filter((task) => {
		if (filters.label) {
			const needle = filters.label.toLowerCase();
			if (!task.labels.some((l) => l.toLowerCase().includes(needle))) {
				return false;
			}
		}
		if (filters.status) {
			if (!task.status.toLowerCase().includes(filters.status.toLowerCase())) {
				return false;
			}
		}
		if (!matchesAssignee(task, scope)) {
			return false;
		}
		if (filters.priority !== undefined && task.priority !== filters.priority) {
			return false;
		}
		return true;
	});
}

/**
 * Expand a substring into the exact names the API filter needs. Names come
 * from the source itself, not config, so a label added since `ttt init` is
 * still found. Returns null when the substring matches nothing, meaning no
 * issue can satisfy the filter.
 */
function expandNames(needle: string, available: string[]): string[] | null {
	const lower = needle.toLowerCase();
	const matches = available.filter((name) =>
		name.toLowerCase().includes(lower),
	);
	return matches.length > 0 ? matches : null;
}

async function searchIssuesFromRemote(
	filters: SearchFilters,
	scope: AssigneeScope,
): Promise<Task[]> {
	const config = await loadConfig();
	const localConfig = await loadLocalConfig();
	const adapter = createAdapter(config);
	const sourceType = getSourceType(config);
	const teamId = config.teams[localConfig.team]?.id;

	if (!teamId) {
		console.error(`Team "${localConfig.team}" not found in config.`);
		return [];
	}

	// Resolve substring filters to exact names so the query stays narrow while
	// keeping the same matching semantics as the local path. Without --status
	// the scope is what `ttt sync` stores, so an unfiltered --remote search
	// answers the same question as the unfiltered local one.
	let statusNames: string[] | undefined = getSyncStatuses(
		getStatusTransitions(config),
	);
	if (filters.status) {
		const statuses = await adapter.getStatuses(teamId);
		const expanded = expandNames(
			filters.status,
			statuses.map((s) => s.name),
		);
		if (!expanded) return [];
		statusNames = expanded;
	}

	let labelNames: string[] | undefined;
	if (filters.label) {
		const labels = await adapter.getLabels(teamId);
		const expanded = expandNames(
			filters.label,
			labels.map((l) => l.name),
		);
		if (!expanded) return [];
		labelNames = expanded;
	}

	const issues = await adapter.getIssues({
		teamId,
		cycleId: config.current_cycle?.id,
		statusNames,
		labelNames,
		assigneeEmails: scope.kind === "user" ? scope.emails : undefined,
	});

	const tasks: Task[] = issues.map((issue) => ({
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
	}));

	// Carry over local status so a remote search reads like the local one.
	const data = await loadCycleData();
	if (data) {
		const localById = new Map(data.tasks.map((task) => [task.id, task]));
		for (const task of tasks) {
			const local = localById.get(task.id);
			if (local) {
				task.localStatus = local.localStatus;
				task.estimate = local.estimate;
			}
		}
	}

	return applyFilters(tasks, filters, scope);
}

async function show() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt show [issue-id] [options]

Show issue details or search for issues from local cycle data.

Arguments:
  issue-id    Optional. Show specific issue (e.g., MP-624)

Options:
  --remote          Fetch from Linear instead of local data
  --export          Output as markdown format
  --label <label>   Filter by label
  --status <status> Filter by status
  --user <email>    Filter by assignee (use "me" for yourself, "unassigned" for no assignee)
  --priority <n>    Filter by priority (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low)

Searches are scoped the same way ttt sync is: current cycle, current_user,
and Todo/In Progress. --status and --user replace the corresponding scope.
The local cache only holds current_user's issues, so searching another
assignee needs --remote.

Examples:
  ttt show                       # Show all issues in local cycle data
  ttt show MP-624                # Show specific issue from local data
  ttt show MP-624 --remote       # Fetch specific issue from Linear
  ttt show MP-624 --export       # Export issue as markdown
  ttt show --label frontend      # Filter local issues by label
  ttt show --status "In Progress" --user me   # My in-progress issues
  ttt show --priority 1          # Show all urgent issues
  ttt show --user tony --remote  # Someone else's issues (needs --remote)
  ttt show --export              # Export all issues as markdown`);
		process.exit(0);
	}

	const useRemote = args.includes("--remote");
	const exportMarkdown = args.includes("--export");

	// Parse filters. Option values are recorded so the issue-ID scan below can
	// skip them - a value like "unassigned" otherwise matches the Trello
	// shortLink pattern and hijacks the whole command.
	const filters: SearchFilters = {};
	const optionValues = new Set<number>();
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--label" && args[i + 1]) {
			filters.label = args[++i];
		} else if (arg === "--status" && args[i + 1]) {
			filters.status = args[++i];
		} else if (arg === "--user" && args[i + 1]) {
			filters.assignee = args[++i];
		} else if (arg === "--priority" && args[i + 1]) {
			filters.priority = parseInt(args[++i], 10);
		} else {
			continue;
		}
		optionValues.add(i);
	}

	// Find issue ID: Linear-style (MP-123) or Trello shortLink (8+ alphanumeric)
	const issueId = args.find(
		(arg, i) =>
			!optionValues.has(i) &&
			!arg.startsWith("-") &&
			(arg.match(/^[A-Z]+-\d+$/i) || arg.match(/^[A-Za-z0-9]{8,}$/)),
	);

	// List mode: no specific issue ID. Filters are optional; --remote runs the
	// same query live instead of reading the cache.
	if (!issueId) {
		const userEmails = await getUserEmails();
		const scope = resolveAssigneeScope(filters.assignee, userEmails);
		let tasks: Task[];

		if (useRemote) {
			const config = await loadConfig();
			const sourceType = getSourceType(config);
			const sourceName = sourceType === "trello" ? "Trello" : "Linear";
			console.error(`Searching issues from ${sourceName}...`);
			tasks = await searchIssuesFromRemote(filters, scope);
		} else {
			const data = await loadCycleData();
			if (!data) {
				console.error("No cycle data found. Run ttt sync first.");
				process.exit(1);
			}
			tasks = applyFilters(data.tasks, filters, scope);

			// The cache only holds what `ttt sync` scoped to current_user, so an
			// empty result here is a scope limit, not an answer.
			if (tasks.length === 0 && scopeEscapesLocalCache(scope, userEmails)) {
				console.error(
					`Local cache only contains issues assigned to ${userEmails.join(", ")}.`,
				);
				console.error(
					`Add --remote to search others: ttt show --user ${filters.assignee} --remote`,
				);
				return;
			}
		}

		if (exportMarkdown) {
			console.log(tasksToMarkdownList(tasks));
		} else {
			displayTaskList(tasks);
		}
		return;
	}

	// Single issue mode
	if (!issueId) {
		console.error("Issue ID is required for single issue lookup.");
		console.error("Usage: ttt show <issue-id> or ttt show --label <label>");
		process.exit(1);
	}

	// Fetch from remote
	if (useRemote) {
		const config = await loadConfig();
		const sourceType = getSourceType(config);
		const sourceName = sourceType === "trello" ? "Trello" : "Linear";
		console.error(`Fetching ${issueId} from ${sourceName}...`);
		const task = await fetchIssueFromRemote(issueId);

		if (!task) {
			console.error(`Issue ${issueId} not found in ${sourceName}.`);
			process.exit(1);
		}

		// Check local data for local status
		const data = await loadCycleData();
		if (data) {
			const localTask = data.tasks.find((t) => t.id === issueId);
			if (localTask) {
				task.localStatus = localTask.localStatus;
			}
		}

		if (exportMarkdown) {
			console.log(taskToMarkdown(task));
		} else {
			displayTaskFull(task, "📋");
		}
		return;
	}

	// Default: get from local cycle data
	const data = await loadCycleData();
	if (!data) {
		console.error("No cycle data found. Run ttt sync first.");
		process.exit(1);
	}

	const task = data.tasks.find(
		(t) => t.id === issueId || t.id === issueId.toUpperCase(),
	);
	if (!task) {
		console.error(`Issue ${issueId} not found in local data.`);
		console.error("Use --remote to fetch from Linear.");
		process.exit(1);
	}

	if (exportMarkdown) {
		console.log(taskToMarkdown(task));
	} else {
		displayTaskFull(task, "📋");
	}
}

show().catch(console.error);
