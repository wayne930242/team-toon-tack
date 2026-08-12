# Extend TTT Commands — Replace Linear Workflow

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `create`, `assign`, `edit`, `cancel` commands to ttt CLI so users can perform most Linear operations locally, with automatic local cache updates.

**Architecture:** Extend `TaskSourceAdapter` interface with mutation methods (`createIssue`, `updateIssue`, `cancelIssue`). Each new CLI command calls the adapter to mutate remote state, then updates `cycle.toon` in-place. Reuse existing patterns: `createAdapter(config)`, `loadCycleData()` / `saveCycleData()`, `@inquirer/prompts` for interactive input.

**Tech Stack:** TypeScript, `@linear/sdk`, `@inquirer/prompts`, `@toon-format/toon`, Biome

---

## Task 1: Extend Adapter Interface with Mutation Types

**Files:**
- Modify: `scripts/lib/adapters/types.ts`

**Step 1: Add new interfaces and methods to types.ts**

Add after `GetIssuesOptions` (around line 119):

```typescript
/**
 * Options for creating a new issue
 */
export interface CreateIssueOptions {
	teamId: string;
	title: string;
	description?: string;
	assigneeId?: string;
	priority?: number; // 0-4
	labelIds?: string[];
	statusId?: string;
	parentIssueId?: string; // Linear UUID of parent
	cycleId?: string;
}

/**
 * Fields that can be updated on an existing issue
 */
export interface UpdateIssueFields {
	title?: string;
	description?: string;
	assigneeId?: string;
	priority?: number;
	labelIds?: string[];
	statusId?: string;
	parentIssueId?: string | null; // null to unlink
}
```

Add to `TaskSourceAdapter` interface (after `addComment`):

```typescript
	/**
	 * Create a new issue/card
	 */
	createIssue(
		options: CreateIssueOptions,
	): Promise<{ success: boolean; issue?: SourceIssue; error?: string }>;

	/**
	 * Update issue fields (title, description, assignee, priority, labels, etc.)
	 */
	updateIssue(
		sourceId: string,
		fields: UpdateIssueFields,
	): Promise<{ success: boolean; error?: string }>;

	/**
	 * Cancel/archive an issue
	 */
	cancelIssue(
		sourceId: string,
	): Promise<{ success: boolean; error?: string }>;
```

**Step 2: Verify types compile**

Run: `npm run type`
Expected: PASS (no errors — adapters will fail until Task 2/3)

Wait — adapters don't implement yet. This step will fail. Skip verification until Task 3 is done.

**Step 3: Commit**

```bash
git add scripts/lib/adapters/types.ts
git commit -m "feat(adapter): add createIssue, updateIssue, cancelIssue to TaskSourceAdapter interface"
```

---

## Task 2: Implement LinearAdapter Mutation Methods

**Files:**
- Modify: `scripts/lib/adapters/linear-adapter.ts`

**Step 1: Implement `createIssue` in LinearAdapter**

Add after `addComment` method (after line 299):

```typescript
	async createIssue(
		options: CreateIssueOptions,
	): Promise<{ success: boolean; issue?: SourceIssue; error?: string }> {
		try {
			const payload = await this.client.createIssue({
				teamId: options.teamId,
				title: options.title,
				description: options.description,
				assigneeId: options.assigneeId,
				priority: options.priority,
				labelIds: options.labelIds,
				stateId: options.statusId,
				parentId: options.parentIssueId,
				cycleId: options.cycleId,
			});
			if (!payload.success) {
				return { success: false, error: "Linear createIssue returned success=false" };
			}
			const created = await payload.issue;
			if (!created) {
				return { success: false, error: "No issue returned from createIssue" };
			}
			const issue = await this.getIssue(created.id);
			if (!issue) {
				return { success: false, error: "Failed to fetch created issue" };
			}
			return { success: true, issue };
		} catch (e) {
			return {
				success: false,
				error: e instanceof Error ? e.message : "Unknown error",
			};
		}
	}
```

**Step 2: Implement `updateIssue` in LinearAdapter**

```typescript
	async updateIssue(
		sourceId: string,
		fields: UpdateIssueFields,
	): Promise<{ success: boolean; error?: string }> {
		try {
			const input: Record<string, unknown> = {};
			if (fields.title !== undefined) input.title = fields.title;
			if (fields.description !== undefined) input.description = fields.description;
			if (fields.assigneeId !== undefined) input.assigneeId = fields.assigneeId;
			if (fields.priority !== undefined) input.priority = fields.priority;
			if (fields.labelIds !== undefined) input.labelIds = fields.labelIds;
			if (fields.statusId !== undefined) input.stateId = fields.statusId;
			if (fields.parentIssueId !== undefined) input.parentId = fields.parentIssueId;

			const payload = await this.client.updateIssue(sourceId, input);
			if (!payload.success) {
				return { success: false, error: `Linear updateIssue returned success=false for ${sourceId}` };
			}
			return { success: true };
		} catch (e) {
			return {
				success: false,
				error: e instanceof Error ? e.message : "Unknown error",
			};
		}
	}
```

**Step 3: Implement `cancelIssue` in LinearAdapter**

```typescript
	async cancelIssue(
		sourceId: string,
	): Promise<{ success: boolean; error?: string }> {
		try {
			// Find the "Cancelled" workflow state for this issue's team
			const issue = await this.client.issue(sourceId);
			const team = await issue.team;
			if (!team) {
				return { success: false, error: "Could not determine issue team" };
			}
			const states = await this.client.workflowStates({
				filter: { team: { id: { eq: team.id } }, type: { eq: "cancelled" } },
			});
			const cancelledState = states.nodes[0];
			if (!cancelledState) {
				return { success: false, error: "No 'cancelled' workflow state found" };
			}
			const payload = await this.client.updateIssue(sourceId, {
				stateId: cancelledState.id,
			});
			if (!payload.success) {
				return { success: false, error: "Linear updateIssue returned success=false" };
			}
			return { success: true };
		} catch (e) {
			return {
				success: false,
				error: e instanceof Error ? e.message : "Unknown error",
			};
		}
	}
```

**Step 4: Add imports for new types**

Update the import block at top of `linear-adapter.ts` to include `CreateIssueOptions` and `UpdateIssueFields`.

**Step 5: Commit**

```bash
git add scripts/lib/adapters/linear-adapter.ts
git commit -m "feat(linear): implement createIssue, updateIssue, cancelIssue"
```

---

## Task 3: Implement TrelloAdapter Stubs

**Files:**
- Modify: `scripts/lib/adapters/trello-adapter.ts`

**Step 1: Add stub implementations to TrelloAdapter**

Add the three methods with "not supported" errors. Trello support can be implemented later.

```typescript
	async createIssue(
		_options: CreateIssueOptions,
	): Promise<{ success: boolean; issue?: SourceIssue; error?: string }> {
		return { success: false, error: "createIssue is not yet supported for Trello" };
	}

	async updateIssue(
		_sourceId: string,
		_fields: UpdateIssueFields,
	): Promise<{ success: boolean; error?: string }> {
		return { success: false, error: "updateIssue is not yet supported for Trello" };
	}

	async cancelIssue(
		_sourceId: string,
	): Promise<{ success: boolean; error?: string }> {
		return { success: false, error: "cancelIssue is not yet supported for Trello" };
	}
```

**Step 2: Add imports for `CreateIssueOptions` and `UpdateIssueFields`**

**Step 3: Run type check**

Run: `npm run type`
Expected: PASS

**Step 4: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/lib/adapters/trello-adapter.ts
git commit -m "feat(trello): add stub implementations for new adapter methods"
```

---

## Task 4: Add Local Cache Update Helper

**Files:**
- Modify: `scripts/utils.ts`

**Step 1: Add `upsertTaskInCycleData` helper**

Add after `preserveLocalTaskFields` (after line 371):

```typescript
/**
 * Update or insert a task in cycle data and save to disk.
 * If the task exists (matched by id), it is replaced. Otherwise it is appended.
 * Returns the updated CycleData.
 */
export async function upsertTaskInCycleData(
	task: Task,
	cycleData: CycleData | null,
): Promise<CycleData> {
	if (!cycleData) {
		console.error("No cycle data found. Run ttt sync first.");
		process.exit(1);
	}
	const idx = cycleData.tasks.findIndex((t) => t.id === task.id);
	if (idx >= 0) {
		cycleData.tasks[idx] = preserveLocalTaskFields(task, cycleData.tasks[idx]);
	} else {
		cycleData.tasks.push(task);
	}
	cycleData.updatedAt = new Date().toISOString();
	await saveCycleData(cycleData);
	return cycleData;
}

/**
 * Remove a task from cycle data by id and save to disk.
 */
export async function removeTaskFromCycleData(
	taskId: string,
	cycleData: CycleData | null,
): Promise<CycleData> {
	if (!cycleData) {
		console.error("No cycle data found. Run ttt sync first.");
		process.exit(1);
	}
	cycleData.tasks = cycleData.tasks.filter((t) => t.id !== taskId);
	cycleData.updatedAt = new Date().toISOString();
	await saveCycleData(cycleData);
	return cycleData;
}
```

**Step 2: Add `sourceIssueToTask` conversion helper**

Add nearby — this converts a `SourceIssue` to a local `Task`, used by multiple commands:

```typescript
/**
 * Convert a SourceIssue from an adapter to a local Task.
 */
export function sourceIssueToTask(
	issue: SourceIssue,
	sourceType: TaskSourceType,
	localStatus: Task["localStatus"] = "pending",
): Task {
	return {
		id: issue.id,
		linearId: issue.sourceId,
		sourceId: issue.sourceId,
		sourceType,
		title: issue.title,
		status: issue.status,
		localStatus,
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
```

**Step 3: Add import for `SourceIssue` type**

Add to the imports at the top of `utils.ts`:

```typescript
import type { SourceIssue } from "./lib/adapters/types.js";
```

**Step 4: Run type check + lint**

Run: `npm run type && npm run lint`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/utils.ts
git commit -m "feat(utils): add upsertTaskInCycleData, removeTaskFromCycleData, sourceIssueToTask helpers"
```

---

## Task 5: Create `ttt create` Command

**Files:**
- Create: `scripts/create.ts`

**Step 1: Write the create command**

Follow existing command patterns (see `comment.ts` for reference). Support both interactive and flag-based usage.

```typescript
#!/usr/bin/env bun
import { input, select } from "@inquirer/prompts";
import { createAdapter } from "./lib/adapters/index.js";
import type { CreateIssueOptions } from "./lib/adapters/types.js";
import {
	type Config,
	getSourceType,
	getTeamId,
	loadConfig,
	loadCycleData,
	loadLocalConfig,
	PRIORITY_NAMES,
	sourceIssueToTask,
	upsertTaskInCycleData,
} from "./utils.js";

interface CreateArgs {
	title?: string;
	description?: string;
	assignee?: string; // user key from config
	priority?: number;
	label?: string;
	status?: string;
	parent?: string; // parent issue identifier (e.g., MP-100)
	interactive: boolean;
}

function parseArgs(args: string[]): CreateArgs {
	const result: CreateArgs = { interactive: true };

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case "-t":
			case "--title":
				result.title = args[++i];
				result.interactive = false;
				break;
			case "-d":
			case "--description":
				result.description = args[++i];
				break;
			case "-a":
			case "--assignee":
				result.assignee = args[++i];
				break;
			case "-p":
			case "--priority":
				result.priority = Number.parseInt(args[++i], 10);
				break;
			case "-l":
			case "--label":
				result.label = args[++i];
				break;
			case "-s":
			case "--status":
				result.status = args[++i];
				break;
			case "--parent":
				result.parent = args[++i];
				break;
			case "--no-interactive":
				result.interactive = false;
				break;
		}
	}

	return result;
}

async function resolveAssigneeId(
	config: Config,
	assigneeKey?: string,
): Promise<string | undefined> {
	if (!assigneeKey) return undefined;
	const user = config.users[assigneeKey];
	if (!user) {
		console.error(`User "${assigneeKey}" not found in config.`);
		console.error(`Available: ${Object.keys(config.users).join(", ")}`);
		process.exit(1);
	}
	return user.id;
}

async function resolveStatusId(
	config: Config,
	statusName?: string,
): Promise<string | undefined> {
	if (!statusName || !config.statuses) return undefined;
	const entry = Object.values(config.statuses).find(
		(s) => s.name.toLowerCase() === statusName.toLowerCase(),
	);
	return entry ? Object.keys(config.statuses!).find(
		(k) => config.statuses![k].name === entry.name,
	) : undefined;
}

async function resolveLabelIds(
	config: Config,
	labelName?: string,
): Promise<string[] | undefined> {
	if (!labelName || !config.labels) return undefined;
	const names = labelName.split(",").map((n) => n.trim());
	const ids: string[] = [];
	for (const name of names) {
		const entry = Object.entries(config.labels).find(
			([, l]) => l.name.toLowerCase() === name.toLowerCase(),
		);
		if (entry) ids.push(entry[0]);
	}
	return ids.length > 0 ? ids : undefined;
}

async function resolveParentSourceId(
	config: Config,
	parentIdentifier?: string,
): Promise<string | undefined> {
	if (!parentIdentifier) return undefined;
	const adapter = createAdapter(config);
	const parent = await adapter.searchIssue(parentIdentifier);
	if (!parent) {
		console.error(`Parent issue "${parentIdentifier}" not found.`);
		process.exit(1);
	}
	return parent.sourceId;
}

async function create() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt create [options]

Create a new issue in Linear/Trello and add to local cycle data.

Options:
  -t, --title <text>       Issue title (required)
  -d, --description <text> Description
  -a, --assignee <key>     Assignee user key from config
  -p, --priority <0-4>     Priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)
  -l, --label <names>      Label names (comma-separated)
  -s, --status <name>      Initial status name
  --parent <id>            Parent issue identifier (e.g., MP-100)
  --no-interactive         Skip interactive prompts

Examples:
  ttt create                              # Interactive mode
  ttt create -t "Fix login bug" -p 2      # Quick create with flags
  ttt create -t "Subtask" --parent MP-100 # Create as child issue`);
		process.exit(0);
	}

	const parsed = parseArgs(args);
	const config = await loadConfig();
	const localConfig = await loadLocalConfig();
	const teamId = getTeamId(config, localConfig.team);
	const sourceType = getSourceType(config);

	let title = parsed.title;
	let description = parsed.description;
	let assigneeKey = parsed.assignee;
	let priority = parsed.priority;
	let labelName = parsed.label;
	let statusName = parsed.status;
	let parentId = parsed.parent;

	// Interactive prompts for missing required fields
	if (!title) {
		title = await input({ message: "Issue title:" });
		if (!title.trim()) {
			console.error("Title is required.");
			process.exit(1);
		}
	}

	if (parsed.interactive) {
		if (description === undefined) {
			description = await input({ message: "Description (optional):", default: "" });
			if (!description) description = undefined;
		}

		if (assigneeKey === undefined) {
			const userChoices = [
				{ name: "(none)", value: "" },
				...Object.entries(config.users).map(([key, u]) => ({
					name: `${u.displayName} (${key})`,
					value: key,
				})),
			];
			assigneeKey = await select({ message: "Assignee:", choices: userChoices });
			if (!assigneeKey) assigneeKey = undefined;
		}

		if (priority === undefined) {
			const priorityChoices = [
				{ name: "None (0)", value: 0 },
				{ name: "Urgent (1)", value: 1 },
				{ name: "High (2)", value: 2 },
				{ name: "Medium (3)", value: 3 },
				{ name: "Low (4)", value: 4 },
			];
			priority = await select({ message: "Priority:", choices: priorityChoices });
		}
	}

	console.log("Creating issue...");

	const assigneeId = await resolveAssigneeId(config, assigneeKey || undefined);
	const statusId = await resolveStatusId(config, statusName);
	const labelIds = await resolveLabelIds(config, labelName);
	const parentSourceId = await resolveParentSourceId(config, parentId);

	// Get current cycle ID for auto-assignment
	const adapter = createAdapter(config);
	const currentCycle = await adapter.getCurrentCycle(teamId);

	const options: CreateIssueOptions = {
		teamId,
		title,
		description,
		assigneeId,
		priority,
		labelIds,
		statusId,
		parentIssueId: parentSourceId,
		cycleId: currentCycle?.id,
	};

	const result = await adapter.createIssue(options);
	if (!result.success || !result.issue) {
		console.error(`Failed to create issue: ${result.error}`);
		process.exit(1);
	}

	const issue = result.issue;
	console.log(`\n✅ Created ${issue.id}: ${issue.title}`);
	if (issue.url) console.log(`   ${issue.url}`);

	// Update local cache
	const cycleData = await loadCycleData();
	if (cycleData) {
		const task = sourceIssueToTask(issue, sourceType);
		await upsertTaskInCycleData(task, cycleData);
		console.log(`   Added to local cycle data.`);
	}
}

create().catch(console.error);
```

**Step 2: Run type check + lint + format**

Run: `npm run type && npm run lint && npm run format`
Expected: PASS

**Step 3: Commit**

```bash
git add scripts/create.ts
git commit -m "feat(cli): add ttt create command for creating issues"
```

---

## Task 6: Create `ttt assign` Command

**Files:**
- Create: `scripts/assign.ts`

**Step 1: Write the assign command**

```typescript
#!/usr/bin/env bun
import { select } from "@inquirer/prompts";
import { createAdapter } from "./lib/adapters/index.js";
import {
	type Config,
	getSourceType,
	getTaskSourceId,
	loadConfig,
	loadCycleData,
	loadLocalConfig,
	saveCycleData,
	type Task,
} from "./utils.js";

function parseArgs(args: string[]): { issueId?: string; assignee?: string } {
	let issueId: string | undefined;
	let assignee: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "-a" || arg === "--assignee") {
			assignee = args[++i];
		} else if (!arg.startsWith("-")) {
			issueId = issueId ?? arg;
		}
	}

	return { issueId, assignee };
}

async function findTask(
	issueId: string | undefined,
	config: Config,
): Promise<{ task: Task; fromLocal: boolean }> {
	const cycleData = await loadCycleData();

	if (!issueId) {
		// Use current in-progress task
		if (!cycleData) {
			console.error("No cycle data found. Run ttt sync first.");
			process.exit(1);
		}
		const inProgress = cycleData.tasks.find((t) => t.localStatus === "in-progress");
		if (!inProgress) {
			console.error("No in-progress task found. Specify issue ID.");
			process.exit(1);
		}
		return { task: inProgress, fromLocal: true };
	}

	const localTask = cycleData?.tasks.find(
		(t) => t.id === issueId || t.id === issueId.toUpperCase(),
	);
	if (localTask) return { task: localTask, fromLocal: true };

	// Fetch from remote
	const adapter = createAdapter(config);
	const issue = await adapter.searchIssue(issueId);
	if (!issue) {
		console.error(`Issue ${issueId} not found.`);
		process.exit(1);
	}
	const sourceType = getSourceType(config);
	return {
		task: {
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
			url: issue.url,
		},
		fromLocal: false,
	};
}

async function assign() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt assign [issue-id] [-a <user-key>]

Reassign an issue to a different user.

Arguments:
  issue-id                Issue ID (e.g., MP-123). If omitted, uses current task.

Options:
  -a, --assignee <key>    User key from config. If omitted, interactive select.

Examples:
  ttt assign MP-123 -a john       # Assign MP-123 to john
  ttt assign -a jane              # Assign current task to jane
  ttt assign MP-123               # Interactive assignee selection`);
		process.exit(0);
	}

	const parsed = parseArgs(args);
	const config = await loadConfig();
	const { task } = await findTask(parsed.issueId, config);

	let assigneeKey = parsed.assignee;
	if (!assigneeKey) {
		const choices = Object.entries(config.users).map(([key, u]) => ({
			name: `${u.displayName} (${key})`,
			value: key,
		}));
		assigneeKey = await select({ message: `Assign ${task.id} to:`, choices });
	}

	const user = config.users[assigneeKey];
	if (!user) {
		console.error(`User "${assigneeKey}" not found.`);
		console.error(`Available: ${Object.keys(config.users).join(", ")}`);
		process.exit(1);
	}

	const sourceId = getTaskSourceId(task);
	if (!sourceId) {
		console.error(`No source ID for ${task.id}.`);
		process.exit(1);
	}

	console.log(`Assigning ${task.id} to ${user.displayName}...`);

	const adapter = createAdapter(config);
	const result = await adapter.updateIssue(sourceId, { assigneeId: user.id });
	if (!result.success) {
		console.error(`Failed: ${result.error}`);
		process.exit(1);
	}

	console.log(`\n✅ ${task.id} assigned to ${user.displayName}`);

	// Update local cache
	const cycleData = await loadCycleData();
	if (cycleData) {
		const localTask = cycleData.tasks.find((t) => t.id === task.id);
		if (localTask) {
			localTask.assignee = user.email;
			cycleData.updatedAt = new Date().toISOString();
			await saveCycleData(cycleData);
			console.log(`   Local cache updated.`);
		}
	}
}

assign().catch(console.error);
```

**Step 2: Run type check + lint + format**

Run: `npm run type && npm run lint && npm run format`
Expected: PASS

**Step 3: Commit**

```bash
git add scripts/assign.ts
git commit -m "feat(cli): add ttt assign command for reassigning issues"
```

---

## Task 7: Create `ttt edit` Command

**Files:**
- Create: `scripts/edit.ts`

**Step 1: Write the edit command**

Supports editing title, description, priority, and labels via flags or interactive prompts.

```typescript
#!/usr/bin/env bun
import { checkbox, input, select } from "@inquirer/prompts";
import { createAdapter } from "./lib/adapters/index.js";
import type { UpdateIssueFields } from "./lib/adapters/types.js";
import {
	getSourceType,
	getTaskSourceId,
	loadConfig,
	loadCycleData,
	saveCycleData,
	sourceIssueToTask,
	type Task,
	upsertTaskInCycleData,
} from "./utils.js";

interface EditArgs {
	issueId?: string;
	title?: string;
	description?: string;
	priority?: number;
	label?: string; // comma-separated label names to SET (replaces all)
	interactive: boolean;
}

function parseArgs(args: string[]): EditArgs {
	const result: EditArgs = { interactive: true };

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case "-t":
			case "--title":
				result.title = args[++i];
				result.interactive = false;
				break;
			case "-d":
			case "--description":
				result.description = args[++i];
				result.interactive = false;
				break;
			case "-p":
			case "--priority":
				result.priority = Number.parseInt(args[++i], 10);
				result.interactive = false;
				break;
			case "-l":
			case "--label":
				result.label = args[++i];
				result.interactive = false;
				break;
			case "--no-interactive":
				result.interactive = false;
				break;
			default:
				if (!arg.startsWith("-") && !result.issueId) {
					result.issueId = arg;
				}
		}
	}

	return result;
}

async function edit() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt edit [issue-id] [options]

Edit an existing issue's fields.

Arguments:
  issue-id                  Issue ID (e.g., MP-123). If omitted, uses current task.

Options:
  -t, --title <text>        New title
  -d, --description <text>  New description
  -p, --priority <0-4>      New priority
  -l, --label <names>       Set labels (comma-separated, replaces existing)
  --no-interactive          Skip interactive prompts

Examples:
  ttt edit MP-123 -t "New title"          # Update title
  ttt edit MP-123 -p 2                    # Set priority to high
  ttt edit -t "Updated" -p 3              # Edit current task
  ttt edit MP-123                         # Interactive edit`);
		process.exit(0);
	}

	const parsed = parseArgs(args);
	const config = await loadConfig();
	const cycleData = await loadCycleData();

	// Find task
	let task: Task | undefined;
	if (!parsed.issueId) {
		task = cycleData?.tasks.find((t) => t.localStatus === "in-progress");
		if (!task) {
			console.error("No in-progress task. Specify issue ID.");
			process.exit(1);
		}
	} else {
		task = cycleData?.tasks.find(
			(t) => t.id === parsed.issueId || t.id === parsed.issueId!.toUpperCase(),
		);
		if (!task) {
			// Try remote
			const adapter = createAdapter(config);
			const issue = await adapter.searchIssue(parsed.issueId);
			if (!issue) {
				console.error(`Issue ${parsed.issueId} not found.`);
				process.exit(1);
			}
			const sourceType = getSourceType(config);
			task = sourceIssueToTask(issue, sourceType);
		}
	}

	const fields: UpdateIssueFields = {};
	let hasChanges = false;

	// Collect changes from flags
	if (parsed.title !== undefined) {
		fields.title = parsed.title;
		hasChanges = true;
	}
	if (parsed.description !== undefined) {
		fields.description = parsed.description;
		hasChanges = true;
	}
	if (parsed.priority !== undefined) {
		fields.priority = parsed.priority;
		hasChanges = true;
	}
	if (parsed.label !== undefined) {
		const names = parsed.label.split(",").map((n) => n.trim());
		const ids: string[] = [];
		for (const name of names) {
			if (!config.labels) break;
			const entry = Object.entries(config.labels).find(
				([, l]) => l.name.toLowerCase() === name.toLowerCase(),
			);
			if (entry) ids.push(entry[0]);
		}
		fields.labelIds = ids;
		hasChanges = true;
	}

	// Interactive mode if no flags provided
	if (parsed.interactive && !hasChanges) {
		const fieldChoices = [
			{ name: "Title", value: "title" },
			{ name: "Description", value: "description" },
			{ name: "Priority", value: "priority" },
			{ name: "Labels", value: "labels" },
		];
		const selected = await checkbox({
			message: `Edit ${task.id} — select fields to change:`,
			choices: fieldChoices,
		});

		for (const field of selected) {
			switch (field) {
				case "title": {
					const newTitle = await input({
						message: "New title:",
						default: task.title,
					});
					if (newTitle && newTitle !== task.title) {
						fields.title = newTitle;
						hasChanges = true;
					}
					break;
				}
				case "description": {
					const newDesc = await input({
						message: "New description:",
						default: task.description ?? "",
					});
					fields.description = newDesc || undefined;
					hasChanges = true;
					break;
				}
				case "priority": {
					const newPriority = await select({
						message: "New priority:",
						choices: [
							{ name: "None (0)", value: 0 },
							{ name: "Urgent (1)", value: 1 },
							{ name: "High (2)", value: 2 },
							{ name: "Medium (3)", value: 3 },
							{ name: "Low (4)", value: 4 },
						],
					});
					fields.priority = newPriority;
					hasChanges = true;
					break;
				}
				case "labels": {
					if (config.labels) {
						const labelChoices = Object.entries(config.labels).map(
							([id, l]) => ({
								name: l.name,
								value: id,
								checked: task!.labels.includes(l.name),
							}),
						);
						fields.labelIds = await checkbox({
							message: "Select labels:",
							choices: labelChoices,
						});
						hasChanges = true;
					}
					break;
				}
			}
		}
	}

	if (!hasChanges) {
		console.log("No changes specified.");
		process.exit(0);
	}

	const sourceId = getTaskSourceId(task);
	if (!sourceId) {
		console.error(`No source ID for ${task.id}.`);
		process.exit(1);
	}

	console.log(`Updating ${task.id}...`);
	const adapter = createAdapter(config);
	const result = await adapter.updateIssue(sourceId, fields);
	if (!result.success) {
		console.error(`Failed: ${result.error}`);
		process.exit(1);
	}

	console.log(`\n✅ ${task.id} updated.`);

	// Refresh from remote and update local cache
	if (cycleData) {
		const refreshed = await adapter.getIssue(sourceId);
		if (refreshed) {
			const sourceType = getSourceType(config);
			const updatedTask = sourceIssueToTask(refreshed, sourceType, task.localStatus);
			await upsertTaskInCycleData(updatedTask, cycleData);
			console.log(`   Local cache updated.`);
		}
	}
}

edit().catch(console.error);
```

**Step 2: Run type check + lint + format**

Run: `npm run type && npm run lint && npm run format`
Expected: PASS

**Step 3: Commit**

```bash
git add scripts/edit.ts
git commit -m "feat(cli): add ttt edit command for editing issue fields"
```

---

## Task 8: Create `ttt cancel` Command

**Files:**
- Create: `scripts/cancel.ts`

**Step 1: Write the cancel command**

```typescript
#!/usr/bin/env bun
import { confirm } from "@inquirer/prompts";
import { createAdapter } from "./lib/adapters/index.js";
import {
	getTaskSourceId,
	loadConfig,
	loadCycleData,
	removeTaskFromCycleData,
} from "./utils.js";

async function cancel() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt cancel <issue-id> [--yes]

Cancel an issue (moves to Cancelled status in Linear).

Arguments:
  issue-id    Issue ID (e.g., MP-123)

Options:
  -y, --yes   Skip confirmation prompt

Examples:
  ttt cancel MP-123         # Cancel with confirmation
  ttt cancel MP-123 --yes   # Cancel without confirmation`);
		process.exit(0);
	}

	const issueId = args.find((a) => !a.startsWith("-"));
	const skipConfirm = args.includes("-y") || args.includes("--yes");

	if (!issueId) {
		console.error("Issue ID is required. Usage: ttt cancel <issue-id>");
		process.exit(1);
	}

	const config = await loadConfig();
	const cycleData = await loadCycleData();

	const task = cycleData?.tasks.find(
		(t) => t.id === issueId || t.id === issueId.toUpperCase(),
	);

	const displayId = task?.id ?? issueId;
	const displayTitle = task ? ` (${task.title})` : "";

	if (!skipConfirm) {
		const ok = await confirm({
			message: `Cancel ${displayId}${displayTitle}?`,
			default: false,
		});
		if (!ok) {
			console.log("Aborted.");
			process.exit(0);
		}
	}

	// Resolve sourceId
	let sourceId: string | undefined;
	if (task) {
		sourceId = getTaskSourceId(task);
	} else {
		const adapter = createAdapter(config);
		const issue = await adapter.searchIssue(issueId);
		if (!issue) {
			console.error(`Issue ${issueId} not found.`);
			process.exit(1);
		}
		sourceId = issue.sourceId;
	}

	if (!sourceId) {
		console.error(`No source ID for ${displayId}.`);
		process.exit(1);
	}

	console.log(`Cancelling ${displayId}...`);
	const adapter = createAdapter(config);
	const result = await adapter.cancelIssue(sourceId);
	if (!result.success) {
		console.error(`Failed: ${result.error}`);
		process.exit(1);
	}

	console.log(`\n✅ ${displayId} cancelled.`);

	// Remove from local cache
	if (cycleData) {
		await removeTaskFromCycleData(displayId, cycleData);
		console.log(`   Removed from local cycle data.`);
	}
}

cancel().catch(console.error);
```

**Step 2: Run type check + lint + format**

Run: `npm run type && npm run lint && npm run format`
Expected: PASS

**Step 3: Commit**

```bash
git add scripts/cancel.ts
git commit -m "feat(cli): add ttt cancel command for cancelling issues"
```

---

## Task 9: Register New Commands in CLI

**Files:**
- Modify: `bin/cli.ts`

**Step 1: Add new commands to COMMANDS array**

Change line 13-25:

```typescript
const COMMANDS = [
	"init",
	"sync",
	"work-on",
	"estimate",
	"done",
	"status",
	"show",
	"comment",
	"create",
	"assign",
	"edit",
	"cancel",
	"config",
	"help",
	"version",
] as const;
```

**Step 2: Add to printHelp()**

Add these lines after the `comment` entry in the help text:

```
  create     Create a new issue
  assign     Reassign an issue to a user
  edit       Edit issue fields (title, description, priority, labels)
  cancel     Cancel an issue
```

**Step 3: Add switch cases**

Add inside the `switch (command)` block, before `case "config"`:

```typescript
			case "create":
				process.argv = ["node", "create.js", ...commandArgs];
				await importScript("create.js");
				break;
			case "assign":
				process.argv = ["node", "assign.js", ...commandArgs];
				await importScript("assign.js");
				break;
			case "edit":
				process.argv = ["node", "edit.js", ...commandArgs];
				await importScript("edit.js");
				break;
			case "cancel":
				process.argv = ["node", "cancel.js", ...commandArgs];
				await importScript("cancel.js");
				break;
```

**Step 4: Build and verify**

Run: `npm run build`
Expected: PASS — all files compile

**Step 5: Run full lint + type check**

Run: `npm run type && npm run lint`
Expected: PASS

**Step 6: Commit**

```bash
git add bin/cli.ts
git commit -m "feat(cli): register create, assign, edit, cancel commands"
```

---

## Task 10: Update CLAUDE.md and Slash Commands

**Files:**
- Modify: `CLAUDE.md` — update the CLI Usage section

**Step 1: Add new commands to Quick Reference**

Add to the CLI Usage block in CLAUDE.md:

```
ttt create             # Create new issue (interactive)
ttt create -t "Title"  # Quick create with flags
ttt assign MP-123      # Reassign issue (interactive)
ttt assign -a john     # Assign current task to john
ttt edit MP-123        # Edit issue fields (interactive)
ttt edit -t "New title" -p 2  # Edit with flags
ttt cancel MP-123      # Cancel an issue
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLI usage with new commands"
```

---

## Task 11: Smoke Test All Commands

**Step 1: Build**

Run: `npm run build`
Expected: PASS

**Step 2: Verify help text for each new command**

Run:
```bash
node dist/bin/cli.js create --help
node dist/bin/cli.js assign --help
node dist/bin/cli.js edit --help
node dist/bin/cli.js cancel --help
```
Expected: Each prints usage text and exits 0.

**Step 3: Verify main help includes new commands**

Run: `node dist/bin/cli.js help`
Expected: Output includes `create`, `assign`, `edit`, `cancel`.

---

## Summary of Changes

| File | Action | Purpose |
|------|--------|---------|
| `scripts/lib/adapters/types.ts` | Modify | Add `CreateIssueOptions`, `UpdateIssueFields`, 3 new adapter methods |
| `scripts/lib/adapters/linear-adapter.ts` | Modify | Implement `createIssue`, `updateIssue`, `cancelIssue` |
| `scripts/lib/adapters/trello-adapter.ts` | Modify | Stub implementations |
| `scripts/utils.ts` | Modify | Add `upsertTaskInCycleData`, `removeTaskFromCycleData`, `sourceIssueToTask` |
| `scripts/create.ts` | Create | `ttt create` command |
| `scripts/assign.ts` | Create | `ttt assign` command |
| `scripts/edit.ts` | Create | `ttt edit` command |
| `scripts/cancel.ts` | Create | `ttt cancel` command |
| `bin/cli.ts` | Modify | Register 4 new commands |
| `CLAUDE.md` | Modify | Document new commands |
