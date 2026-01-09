/**
 * Generic prompt functions shared between Linear and Trello init
 */

import { checkbox, select } from "@inquirer/prompts";
import type { TaskSourceType } from "../adapters/types.js";
import type { LinearLabel, LinearUser } from "../config-builder.js";
import type { InitOptions } from "./types.js";

export async function selectTaskSource(
	options: InitOptions,
): Promise<TaskSourceType> {
	if (options.source) {
		return options.source;
	}

	if (!options.interactive) {
		return "linear"; // default
	}

	console.log("\n📦 Select Task Source:");
	const source = await select({
		message: "Which task management system do you use?",
		choices: [
			{
				name: "Linear (recommended)",
				value: "linear" as const,
				description: "Full feature support with cycles and workflows",
			},
			{
				name: "Trello",
				value: "trello" as const,
				description: "Board-based task management with lists as statuses",
			},
		],
		default: "linear",
	});

	return source;
}

export async function selectUser(
	users: LinearUser[],
	options: InitOptions,
): Promise<LinearUser> {
	let currentUser = users[0];
	if (options.user) {
		const found = users.find(
			(u) =>
				u.email?.toLowerCase() === options.user?.toLowerCase() ||
				u.displayName?.toLowerCase() === options.user?.toLowerCase(),
		);
		if (found) currentUser = found;
	} else if (options.interactive) {
		const userId = await select({
			message: "Select yourself:",
			choices: users.map((u) => ({
				name: `${u.displayName || u.name} (${u.email})`,
				value: u.id,
			})),
		});
		currentUser = users.find((u) => u.id === userId) || users[0];
	}
	return currentUser;
}

export async function selectLabelFilter(
	labels: LinearLabel[],
	options: InitOptions,
): Promise<string[] | undefined> {
	if (options.labels && options.labels.length > 0) {
		return options.labels;
	}

	if (options.interactive && labels.length > 0) {
		const labelChoices = labels.map((l) => ({ name: l.name, value: l.name }));
		const selectedLabels = await checkbox({
			message: "Select label filters (space to select, enter to confirm):",
			choices: labelChoices,
		});
		return selectedLabels.length > 0 ? selectedLabels : undefined;
	}

	return undefined;
}

export async function selectStatusSource(
	options: InitOptions,
): Promise<"remote" | "local"> {
	if (!options.interactive) {
		return "remote"; // default
	}

	console.log("\n🔄 Configure status sync mode:");
	const statusSource = await select({
		message: "Where should status updates be stored?",
		choices: [
			{
				name: "Remote (recommended)",
				value: "remote" as const,
				description:
					"Update Linear immediately when you work-on or complete tasks",
			},
			{
				name: "Local",
				value: "local" as const,
				description: "Work offline, then sync to Linear with 'sync --update'",
			},
		],
		default: "remote",
	});

	return statusSource;
}
