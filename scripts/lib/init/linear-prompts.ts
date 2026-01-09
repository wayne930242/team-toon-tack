/**
 * Linear-specific prompt functions for init
 */

import { checkbox, password, select } from "@inquirer/prompts";
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
		apiKey = await password({
			message: "Enter your Linear API key:",
			validate: (v) =>
				v.startsWith("lin_api_")
					? true
					: 'API key should start with "lin_api_"',
		});
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
		const teamId = await select({
			message: "Select your dev team (for work-on/done commands):",
			choices: teams.map((t) => ({ name: t.name, value: t.id })),
		});

		if (teamId) {
			devTeam = teams.find((t) => t.id === teamId) || teams[0];
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
		name: `${s.name} (${s.type})`,
		value: s.name,
	}));

	const testingStatus = await select<string | undefined>({
		message:
			"Select testing/review status for dev team (used when strict_review mode):",
		choices: [
			{ name: "(Skip - no testing status)", value: undefined },
			...stateChoices,
		],
	});

	return testingStatus;
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
	const qaPmTeamIds = await checkbox({
		message:
			"Select QA/PM teams for cross-team parent updates (space to select, enter to confirm):",
		choices: otherTeams.map((t) => ({
			name: t.name,
			value: t.id,
		})),
	});

	if (qaPmTeamIds.length === 0) {
		return [];
	}

	// For each selected QA/PM team, select its testing status
	const qaPmTeams: QaPmTeamConfig[] = [];

	for (const teamId of qaPmTeamIds) {
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
			name: `${s.name} (${s.type})`,
			value: s.name,
		}));

		const testingStatus = await select<string | undefined>({
			message: `Select testing status for ${team.name}:`,
			choices: [
				{ name: "(Skip this team)", value: undefined },
				...stateChoices,
			],
			default: defaults.testing,
		});

		if (testingStatus) {
			qaPmTeams.push({
				team: teamKey,
				testing_status: testingStatus,
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
	const defaultMode = hasQaPmTeams ? "upstream_strict" : "simple";

	const mode = await select({
		message: "How should tasks be completed?",
		choices: [
			{
				name: "Simple",
				value: "simple" as const,
				description: "Mark task as done directly",
			},
			{
				name: "Strict Review",
				value: "strict_review" as const,
				description: "Mark task to dev team's testing status",
			},
			{
				name: "Upstream Strict (recommended with QA/PM)",
				value: "upstream_strict" as const,
				description:
					"Done + parent to testing, fallback to testing if no parent",
			},
			{
				name: "Upstream Not Strict",
				value: "upstream_not_strict" as const,
				description: "Done + parent to testing, no fallback",
			},
		],
		default: defaultMode,
	});

	return mode;
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
		name: `${s.name} (${s.type})`,
		value: s.name,
	}));

	const todo = await select({
		message: 'Select status for "Todo" (pending tasks):',
		choices: devStateChoices,
		default: devDefaults.todo,
	});

	const in_progress = await select({
		message: 'Select status for "In Progress" (working tasks):',
		choices: devStateChoices,
		default: devDefaults.in_progress,
	});

	const done = await select({
		message: 'Select status for "Done" (completed tasks):',
		choices: devStateChoices,
		default: devDefaults.done,
	});

	const blockedChoices = [
		{
			name: "(Skip - no blocked status)",
			value: undefined as string | undefined,
		},
		...devStateChoices,
	];
	const blocked = await select<string | undefined>({
		message: 'Select status for "Blocked" (optional, for blocked tasks):',
		choices: blockedChoices,
		default: devDefaults.blocked,
	});

	return {
		todo: todo || devDefaults.todo,
		in_progress: in_progress || devDefaults.in_progress,
		done: done || devDefaults.done,
		testing: devDefaults.testing, // Will be overridden by dev_testing_status in LocalConfig
		blocked: blocked,
	};
}
