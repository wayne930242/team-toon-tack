#!/usr/bin/env bun
import { checkbox, input, select } from "@inquirer/prompts";
import { createAdapter } from "./lib/adapters/index.js";
import type { UpdateIssueFields } from "./lib/adapters/types.js";
import {
	getSourceType,
	getTaskSourceId,
	loadConfig,
	loadCycleData,
	sourceIssueToTask,
	type Task,
	upsertTaskInCycleData,
} from "./utils.js";

interface EditArgs {
	issueId?: string;
	title?: string;
	description?: string;
	priority?: number;
	label?: string;
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

	let task: Task | undefined;
	if (!parsed.issueId) {
		task = cycleData?.tasks.find((t) => t.localStatus === "in-progress");
		if (!task) {
			console.error("No in-progress task. Specify issue ID.");
			process.exit(1);
		}
	} else {
		task = cycleData?.tasks.find(
			(t) => t.id === parsed.issueId || t.id === parsed.issueId?.toUpperCase(),
		);
		if (!task) {
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
		if (config.labels) {
			for (const name of names) {
				const entry = Object.entries(config.labels).find(
					([, l]) => l.name.toLowerCase() === name.toLowerCase(),
				);
				if (entry) ids.push(entry[0]);
			}
		}
		fields.labelIds = ids;
		hasChanges = true;
	}

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
					fields.priority = await select({
						message: "New priority:",
						choices: [
							{ name: "None (0)", value: 0 },
							{ name: "Urgent (1)", value: 1 },
							{ name: "High (2)", value: 2 },
							{ name: "Medium (3)", value: 3 },
							{ name: "Low (4)", value: 4 },
						],
					});
					hasChanges = true;
					break;
				}
				case "labels": {
					if (config.labels) {
						const labelChoices = Object.entries(config.labels).map(
							([id, l]) => ({
								name: l.name,
								value: id,
								checked: task?.labels.includes(l.name) ?? false,
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

	if (cycleData) {
		const refreshed = await adapter.getIssue(sourceId);
		if (refreshed) {
			const sourceType = getSourceType(config);
			const updatedTask = sourceIssueToTask(
				refreshed,
				sourceType,
				task.localStatus,
			);
			await upsertTaskInCycleData(updatedTask, cycleData);
			console.log(`   Local cache updated.`);
		}
	}
}

edit().catch(console.error);
