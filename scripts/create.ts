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
	sourceIssueToTask,
	upsertTaskInCycleData,
} from "./utils.js";

interface CreateArgs {
	title?: string;
	description?: string;
	assignee?: string;
	priority?: number;
	label?: string;
	status?: string;
	parent?: string;
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

function resolveAssigneeId(
	config: Config,
	assigneeKey?: string,
): string | undefined {
	if (!assigneeKey) return undefined;
	const user = config.users[assigneeKey];
	if (!user) {
		console.error(`User "${assigneeKey}" not found in config.`);
		console.error(`Available: ${Object.keys(config.users).join(", ")}`);
		process.exit(1);
	}
	return user.id;
}

function resolveStatusId(
	config: Config,
	statusName?: string,
): string | undefined {
	if (!statusName || !config.statuses) return undefined;
	const entry = Object.entries(config.statuses).find(
		([, s]) => s.name.toLowerCase() === statusName.toLowerCase(),
	);
	return entry ? entry[0] : undefined;
}

function resolveLabelIds(
	config: Config,
	labelArg?: string,
): string[] | undefined {
	if (!labelArg || !config.labels) return undefined;
	const names = labelArg.split(",").map((n) => n.trim());
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
	const labelArg = parsed.label;
	const statusName = parsed.status;
	const parentId = parsed.parent;

	if (!title) {
		title = await input({ message: "Issue title:" });
		if (!title.trim()) {
			console.error("Title is required.");
			process.exit(1);
		}
	}

	if (parsed.interactive) {
		if (description === undefined) {
			const desc = await input({
				message: "Description (optional):",
				default: "",
			});
			description = desc || undefined;
		}

		if (assigneeKey === undefined) {
			const userChoices = [
				{ name: "(none)", value: "" },
				...Object.entries(config.users).map(([key, u]) => ({
					name: `${u.displayName} (${key})`,
					value: key,
				})),
			];
			const picked = await select({
				message: "Assignee:",
				choices: userChoices,
			});
			assigneeKey = picked || undefined;
		}

		if (priority === undefined) {
			priority = await select({
				message: "Priority:",
				choices: [
					{ name: "None (0)", value: 0 },
					{ name: "Urgent (1)", value: 1 },
					{ name: "High (2)", value: 2 },
					{ name: "Medium (3)", value: 3 },
					{ name: "Low (4)", value: 4 },
				],
			});
		}
	}

	console.log("Creating issue...");

	const assigneeId = resolveAssigneeId(config, assigneeKey);
	const statusId = resolveStatusId(config, statusName);
	const labelIds = resolveLabelIds(config, labelArg);
	const parentSourceId = await resolveParentSourceId(config, parentId);

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

	const cycleData = await loadCycleData();
	if (cycleData) {
		const task = sourceIssueToTask(issue, sourceType);
		await upsertTaskInCycleData(task, cycleData);
		console.log(`   Added to local cycle data.`);
	}
}

create().catch(console.error);
