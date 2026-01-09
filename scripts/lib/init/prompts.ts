/**
 * Generic prompt functions shared between Linear and Trello init
 */

import prompts from "prompts";
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
	const response = await prompts({
		type: "select",
		name: "source",
		message: "Which task management system do you use?",
		choices: [
			{
				title: "Linear (recommended)",
				value: "linear",
				description: "Full feature support with cycles and workflows",
			},
			{
				title: "Trello",
				value: "trello",
				description: "Board-based task management with lists as statuses",
			},
		],
		initial: 0,
	});

	return response.source || "linear";
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
		const response = await prompts({
			type: "select",
			name: "userId",
			message: "Select yourself:",
			choices: users.map((u) => ({
				title: `${u.displayName || u.name} (${u.email})`,
				value: u.id,
			})),
		});
		currentUser = users.find((u) => u.id === response.userId) || users[0];
	}
	return currentUser;
}

export async function selectLabelFilter(
	labels: LinearLabel[],
	options: InitOptions,
): Promise<string | undefined> {
	if (options.label) {
		return options.label;
	}

	if (options.interactive && labels.length > 0) {
		const labelChoices = [
			{ title: "(No filter - sync all labels)", value: undefined },
			...labels.map((l) => ({ title: l.name, value: l.name })),
		];
		const response = await prompts({
			type: "select",
			name: "label",
			message: "Select label filter (optional):",
			choices: labelChoices,
		});
		return response.label;
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
	const response = await prompts({
		type: "select",
		name: "statusSource",
		message: "Where should status updates be stored?",
		choices: [
			{
				title: "Remote (recommended)",
				value: "remote",
				description:
					"Update Linear immediately when you work-on or complete tasks",
			},
			{
				title: "Local",
				value: "local",
				description: "Work offline, then sync to Linear with 'sync --update'",
			},
		],
		initial: 0,
	});

	return response.statusSource || "remote";
}
