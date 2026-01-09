import { createAdapter } from "./lib/adapters/index.js";
import {
	displayTaskFull,
	getStatusIcon,
	PRIORITY_LABELS,
} from "./lib/display.js";
import {
	getSourceType,
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
	if (task.branch) lines.push(`- **Branch**: \`${task.branch}\``);
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

		console.log(`${icon} ${task.id}: ${task.title}`);
		console.log(
			`   Status: ${task.status} | Priority: ${priority} | Assignee: ${assignee}`,
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
		branch: issue.branchName,
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

async function searchIssuesFromRemote(filters: SearchFilters): Promise<Task[]> {
	const config = await loadConfig();
	const localConfig = await loadLocalConfig();
	const adapter = createAdapter(config);
	const sourceType = getSourceType(config);
	const teamId = config.teams[localConfig.team]?.id;

	if (!teamId) {
		console.error(`Team "${localConfig.team}" not found in config.`);
		return [];
	}

	// Use adapter to get issues with filters
	// Note: adapter API is simpler, filters applied in-memory for consistency
	const issues = await adapter.getIssues({
		teamId,
		statusNames: filters.status ? [filters.status] : undefined,
		labelName: filters.label,
		limit: 50,
	});

	const tasks: Task[] = [];

	for (const issue of issues) {
		// Apply additional filters
		if (filters.assignee) {
			const assigneeLower = filters.assignee.toLowerCase();
			if (assigneeLower === "me") {
				const userEmail =
					config.users[localConfig.current_user]?.email?.toLowerCase();
				if (!userEmail || issue.assigneeEmail?.toLowerCase() !== userEmail) {
					continue;
				}
			} else if (assigneeLower === "unassigned") {
				if (issue.assigneeEmail) {
					continue;
				}
			} else {
				if (!issue.assigneeEmail?.toLowerCase().includes(assigneeLower)) {
					continue;
				}
			}
		}

		if (filters.priority !== undefined && issue.priority !== filters.priority) {
			continue;
		}

		const task: Task = {
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
			branch: issue.branchName,
			description: issue.description,
			parentIssueId: issue.parentIssueId,
			url: issue.url,
		};

		tasks.push(task);
	}

	return tasks;
}

async function searchIssuesFromLocal(
	data: { tasks: Task[] },
	filters: SearchFilters,
): Promise<Task[]> {
	let tasks = data.tasks;

	if (filters.label) {
		const labelLower = filters.label.toLowerCase();
		tasks = tasks.filter((t) =>
			t.labels.some((l) => l.toLowerCase().includes(labelLower)),
		);
	}

	if (filters.status) {
		const statusLower = filters.status.toLowerCase();
		tasks = tasks.filter((t) => t.status.toLowerCase().includes(statusLower));
	}

	if (filters.assignee) {
		const assigneeLower = filters.assignee.toLowerCase();
		if (assigneeLower === "unassigned") {
			tasks = tasks.filter((t) => !t.assignee);
		} else if (assigneeLower === "me") {
			const localConfig = await loadLocalConfig();
			const config = await loadConfig();
			const userEmail =
				config.users[localConfig.current_user]?.email?.toLowerCase();
			if (userEmail) {
				tasks = tasks.filter((t) => t.assignee?.toLowerCase() === userEmail);
			}
		} else {
			tasks = tasks.filter((t) =>
				t.assignee?.toLowerCase().includes(assigneeLower),
			);
		}
	}

	if (filters.priority !== undefined) {
		tasks = tasks.filter((t) => t.priority === filters.priority);
	}

	return tasks;
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

Examples:
  ttt show                       # Show all issues in local cycle data
  ttt show MP-624                # Show specific issue from local data
  ttt show MP-624 --remote       # Fetch specific issue from Linear
  ttt show MP-624 --export       # Export issue as markdown
  ttt show --label frontend      # Filter local issues by label
  ttt show --status "In Progress" --user me   # My in-progress issues
  ttt show --priority 1          # Show all urgent issues
  ttt show --export              # Export all issues as markdown`);
		process.exit(0);
	}

	const useRemote = args.includes("--remote");
	const exportMarkdown = args.includes("--export");

	// Parse filters
	const filters: SearchFilters = {};
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
		}
	}

	// Check if this is a search (has filters) or single issue lookup
	const hasFilters = Object.keys(filters).length > 0;

	// Find issue ID (argument that doesn't start with -)
	const issueId = args.find(
		(arg) => !arg.startsWith("-") && arg.match(/^[A-Z]+-\d+$/i),
	);

	// If no issue ID and no filters, show all local issues
	if (!issueId && !hasFilters) {
		const data = await loadCycleData();
		if (!data) {
			console.error("No cycle data found. Run ttt sync first.");
			process.exit(1);
		}
		if (exportMarkdown) {
			console.log(tasksToMarkdownList(data.tasks));
		} else {
			displayTaskList(data.tasks);
		}
		return;
	}

	// Search mode: has filters but no specific issue ID
	if (hasFilters && !issueId) {
		let tasks: Task[];
		if (useRemote) {
			const config = await loadConfig();
			const sourceType = getSourceType(config);
			const sourceName = sourceType === "trello" ? "Trello" : "Linear";
			console.error(`Searching issues from ${sourceName}...`);
			tasks = await searchIssuesFromRemote(filters);
		} else {
			const data = await loadCycleData();
			if (!data) {
				console.error("No cycle data found. Run ttt sync first.");
				process.exit(1);
			}
			tasks = await searchIssuesFromLocal(data, filters);
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
