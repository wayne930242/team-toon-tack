/**
 * Linear-specific prompt functions for init
 */

import { checkbox, input, password, select } from "@inquirer/prompts";
import { LinearClient } from "@linear/sdk";
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
import { getFirstTodoStatus } from "../status-helpers.js";
import type { InitOptions } from "./types.js";

export interface ResolvedApiKey {
	apiKey: string;
	envName: string; // env var name that stores this key (e.g. LINEAR_API_KEY or LINEAR_API_KEY_WORK)
	fromSystemEnv: boolean; // true if the value was already in process.env before init
	organizationName?: string;
}

interface Candidate {
	envName: string;
	apiKey: string;
	orgName?: string;
	orgUrlKey?: string;
	error?: string;
}

function collectEnvCandidates(): Candidate[] {
	const candidates: Candidate[] = [];
	for (const [name, value] of Object.entries(process.env)) {
		if (!value) continue;
		if (name === "LINEAR_API_KEY" || name.startsWith("LINEAR_API_KEY_")) {
			if (value.startsWith("lin_api_")) {
				candidates.push({ envName: name, apiKey: value });
			}
		}
	}
	return candidates;
}

async function probeWorkspace(candidate: Candidate): Promise<void> {
	try {
		const client = new LinearClient({ apiKey: candidate.apiKey });
		const org = await client.organization;
		candidate.orgName = org.name;
		candidate.orgUrlKey = org.urlKey;
	} catch (err) {
		candidate.error = err instanceof Error ? err.message : String(err);
	}
}

function validateApiKey(v: string): true | string {
	return v.startsWith("lin_api_")
		? true
		: 'API key should start with "lin_api_"';
}

/**
 * Detect available Linear API keys from process.env, probe each for its
 * workspace, and let the user pick. Supports adding a new key inline.
 * Returns the chosen key plus the env var name that holds it.
 */
export async function promptForApiKey(
	options: InitOptions,
): Promise<ResolvedApiKey | undefined> {
	// Non-interactive: use --api-key or LINEAR_API_KEY, no selection possible
	if (!options.interactive) {
		const apiKey = options.apiKey || process.env.LINEAR_API_KEY;
		if (!apiKey) return undefined;
		return {
			apiKey,
			envName: "LINEAR_API_KEY",
			fromSystemEnv: !options.apiKey && !!process.env.LINEAR_API_KEY,
		};
	}

	// --api-key flag short-circuits the workspace picker
	if (options.apiKey) {
		return {
			apiKey: options.apiKey,
			envName: "LINEAR_API_KEY",
			fromSystemEnv: false,
		};
	}

	const envCandidates = collectEnvCandidates();

	if (envCandidates.length > 0) {
		console.log(
			`\n🔑 Found ${envCandidates.length} Linear API key${envCandidates.length > 1 ? "s" : ""} in environment. Probing workspaces...`,
		);
		await Promise.all(envCandidates.map(probeWorkspace));

		for (const c of envCandidates) {
			if (c.error) {
				console.log(`  ✗ ${c.envName} — error: ${c.error}`);
			} else {
				console.log(
					`  ✓ ${c.envName} → ${c.orgName ?? "?"}${c.orgUrlKey ? ` (${c.orgUrlKey})` : ""}`,
				);
			}
		}

		const valid = envCandidates.filter((c) => !c.error);
		const choices = [
			...valid.map((c) => ({
				name: `${c.orgName ?? "(unknown)"}  [${c.envName}]`,
				value: c.envName,
				description: c.orgUrlKey ? `${c.orgUrlKey}.linear.app` : undefined,
			})),
			{ name: "+ Enter a different API key", value: "__new__" },
		];

		const chosen = await select({
			message: "Select workspace:",
			choices,
		});

		if (chosen !== "__new__") {
			const picked = valid.find((c) => c.envName === chosen);
			if (picked) {
				return {
					apiKey: picked.apiKey,
					envName: picked.envName,
					fromSystemEnv: true,
					organizationName: picked.orgName,
				};
			}
		}
	}

	// No env keys, or user chose to enter a new one
	const apiKey = await password({
		message: "Enter your Linear API key:",
		validate: validateApiKey,
	});

	const newCandidate: Candidate = {
		envName: "LINEAR_API_KEY",
		apiKey,
	};
	await probeWorkspace(newCandidate);
	if (newCandidate.error) {
		console.error(`  ✗ Failed to fetch workspace: ${newCandidate.error}`);
		return undefined;
	}
	console.log(
		`  ✓ Workspace: ${newCandidate.orgName}${newCandidate.orgUrlKey ? ` (${newCandidate.orgUrlKey})` : ""}`,
	);

	// Ask for env var name (default to a slugged workspace name if LINEAR_API_KEY is taken)
	const defaultName = process.env.LINEAR_API_KEY
		? `LINEAR_API_KEY_${(
				newCandidate.orgUrlKey ??
				newCandidate.orgName ??
				"ALT"
			)
				.toUpperCase()
				.replace(/[^A-Z0-9]/g, "_")}`
		: "LINEAR_API_KEY";

	const envName = await input({
		message: "Env variable name to store this key under:",
		default: defaultName,
		validate: (v) =>
			/^[A-Z_][A-Z0-9_]*$/.test(v) ||
			"Env var names must be uppercase letters, digits, underscore",
	});

	return {
		apiKey,
		envName,
		fromSystemEnv: false,
		organizationName: newCandidate.orgName,
	};
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
		default: getFirstTodoStatus(devDefaults.todo),
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
