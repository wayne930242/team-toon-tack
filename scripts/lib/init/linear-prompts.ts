/**
 * Linear-specific prompt functions for init
 */

import prompts from "prompts";
import type {
	CompletionMode,
	QaPmTeamConfig,
	StatusTransitions,
} from "../../utils.js";
import {
	getDefaultStatusTransitions,
	type LinearState,
	type LinearTeam,
} from "../config-builder.js";
import type { InitOptions } from "./types.js";

export async function promptForApiKey(
	options: InitOptions,
): Promise<string | undefined> {
	let apiKey = options.apiKey || process.env.LINEAR_API_KEY;
	if (!apiKey && options.interactive) {
		const response = await prompts({
			type: "password",
			name: "apiKey",
			message: "Enter your Linear API key:",
			validate: (v) =>
				v.startsWith("lin_api_")
					? true
					: 'API key should start with "lin_api_"',
		});
		apiKey = response.apiKey;
	}
	return apiKey;
}

export async function selectDevTeam(
	teams: LinearTeam[],
	options: InitOptions,
): Promise<LinearTeam> {
	let devTeam = teams[0];

	if (options.team) {
		const found = teams.find(
			(t) => t.name.toLowerCase() === options.team?.toLowerCase(),
		);
		if (found) {
			devTeam = found;
		}
	} else if (options.interactive && teams.length > 1) {
		console.log("\n👨‍💻 Dev Team Configuration:");
		const response = await prompts({
			type: "select",
			name: "teamId",
			message: "Select your dev team (for work-on/done commands):",
			choices: teams.map((t) => ({ title: t.name, value: t.id })),
		});

		if (response.teamId) {
			devTeam = teams.find((t) => t.id === response.teamId) || teams[0];
		}
	}

	return devTeam;
}

export async function selectDevTestingStatus(
	devStates: LinearState[],
	options: InitOptions,
): Promise<string | undefined> {
	if (!options.interactive || devStates.length === 0) {
		return getDefaultStatusTransitions(devStates).testing;
	}

	console.log("\n🔍 Dev Team Testing/Review Status:");
	const stateChoices = devStates.map((s) => ({
		title: `${s.name} (${s.type})`,
		value: s.name,
	}));

	const response = await prompts({
		type: "select",
		name: "testingStatus",
		message:
			"Select testing/review status for dev team (used when strict_review mode):",
		choices: [
			{ title: "(Skip - no testing status)", value: undefined },
			...stateChoices,
		],
		initial: 0,
	});

	return response.testingStatus;
}

export async function selectQaPmTeams(
	teams: LinearTeam[],
	devTeam: LinearTeam,
	teamStatesMap: Map<string, LinearState[]>,
	teamsConfig: Record<string, { id: string; name: string }>,
	options: InitOptions,
): Promise<QaPmTeamConfig[]> {
	// Only ask if there are multiple teams and interactive mode
	if (!options.interactive || teams.length <= 1) {
		return [];
	}

	// Filter out dev team from choices
	const otherTeams = teams.filter((t) => t.id !== devTeam.id);
	if (otherTeams.length === 0) {
		return [];
	}

	console.log("\n🔗 QA/PM Teams Configuration:");
	const response = await prompts({
		type: "multiselect",
		name: "qaPmTeamIds",
		message:
			"Select QA/PM teams for cross-team parent updates (space to select, enter to confirm):",
		choices: [
			...otherTeams.map((t) => ({
				title: t.name,
				value: t.id,
				description: "Parent issues in this team will be updated to Testing",
			})),
		],
		hint: "- Press space to select, enter to confirm. Leave empty to skip.",
	});

	if (!response.qaPmTeamIds || response.qaPmTeamIds.length === 0) {
		return [];
	}

	// For each selected QA/PM team, select its testing status
	const qaPmTeams: QaPmTeamConfig[] = [];

	for (const teamId of response.qaPmTeamIds) {
		const team = teams.find((t) => t.id === teamId);
		if (!team) continue;

		const teamStates = teamStatesMap.get(teamId) || [];
		const defaults = getDefaultStatusTransitions(teamStates);

		// Find team key
		const teamKey =
			Object.entries(teamsConfig).find(([_, t]) => t.id === teamId)?.[0] ||
			team.name.toLowerCase().replace(/[^a-z0-9]/g, "_");

		if (teamStates.length === 0) {
			// No states available, use default
			if (defaults.testing) {
				qaPmTeams.push({
					team: teamKey,
					testing_status: defaults.testing,
				});
			}
			continue;
		}

		const stateChoices = teamStates.map((s) => ({
			title: `${s.name} (${s.type})`,
			value: s.name,
		}));

		const statusResponse = await prompts({
			type: "select",
			name: "testingStatus",
			message: `Select testing status for ${team.name}:`,
			choices: [
				{ title: "(Skip this team)", value: undefined },
				...stateChoices,
			],
			initial: defaults.testing
				? stateChoices.findIndex((c) => c.value === defaults.testing) + 1
				: 0,
		});

		if (statusResponse.testingStatus) {
			qaPmTeams.push({
				team: teamKey,
				testing_status: statusResponse.testingStatus,
			});
		}
	}

	return qaPmTeams;
}

export async function selectCompletionMode(
	hasQaPmTeams: boolean,
	options: InitOptions,
): Promise<CompletionMode> {
	if (!options.interactive) {
		return hasQaPmTeams ? "upstream_strict" : "simple";
	}

	console.log("\n✅ Completion Mode Configuration:");
	const defaultMode = hasQaPmTeams ? 2 : 0; // upstream_strict if has QA/PM teams, else simple

	const response = await prompts({
		type: "select",
		name: "mode",
		message: "How should tasks be completed?",
		choices: [
			{
				title: "Simple",
				value: "simple",
				description: "Mark task as done directly",
			},
			{
				title: "Strict Review",
				value: "strict_review",
				description: "Mark task to dev team's testing status",
			},
			{
				title: "Upstream Strict (recommended with QA/PM)",
				value: "upstream_strict",
				description:
					"Done + parent to testing, fallback to testing if no parent",
			},
			{
				title: "Upstream Not Strict",
				value: "upstream_not_strict",
				description: "Done + parent to testing, no fallback",
			},
		],
		initial: defaultMode,
	});

	return response.mode || (hasQaPmTeams ? "upstream_strict" : "simple");
}

export async function selectStatusMappings(
	devStates: LinearState[],
	options: InitOptions,
): Promise<StatusTransitions> {
	// Use dev team states for todo, in_progress, done, blocked
	// Testing status is now configured separately (dev_testing_status and qa_pm_teams)
	const devDefaults = getDefaultStatusTransitions(devStates);

	if (!options.interactive || devStates.length === 0) {
		return devDefaults;
	}

	console.log("\n📊 Configure status mappings (dev team):");

	const devStateChoices = devStates.map((s) => ({
		title: `${s.name} (${s.type})`,
		value: s.name,
	}));

	const todoResponse = await prompts({
		type: "select",
		name: "todo",
		message: 'Select status for "Todo" (pending tasks):',
		choices: devStateChoices,
		initial: devStateChoices.findIndex((c) => c.value === devDefaults.todo),
	});

	const inProgressResponse = await prompts({
		type: "select",
		name: "in_progress",
		message: 'Select status for "In Progress" (working tasks):',
		choices: devStateChoices,
		initial: devStateChoices.findIndex(
			(c) => c.value === devDefaults.in_progress,
		),
	});

	const doneResponse = await prompts({
		type: "select",
		name: "done",
		message: 'Select status for "Done" (completed tasks):',
		choices: devStateChoices,
		initial: devStateChoices.findIndex((c) => c.value === devDefaults.done),
	});

	const blockedChoices = [
		{ title: "(Skip - no blocked status)", value: undefined },
		...devStateChoices,
	];
	const blockedResponse = await prompts({
		type: "select",
		name: "blocked",
		message: 'Select status for "Blocked" (optional, for blocked tasks):',
		choices: blockedChoices,
		initial: devDefaults.blocked
			? blockedChoices.findIndex((c) => c.value === devDefaults.blocked)
			: 0,
	});

	return {
		todo: todoResponse.todo || devDefaults.todo,
		in_progress: inProgressResponse.in_progress || devDefaults.in_progress,
		done: doneResponse.done || devDefaults.done,
		testing: devDefaults.testing, // Will be overridden by dev_testing_status in LocalConfig
		blocked: blockedResponse.blocked,
	};
}
