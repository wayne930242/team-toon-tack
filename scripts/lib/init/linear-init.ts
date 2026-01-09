/**
 * Linear initialization flow
 */

import fs from "node:fs/promises";
import { decode, encode } from "@toon-format/toon";
import {
	type Config,
	fileExists,
	getLinearClient,
	type LocalConfig,
} from "../../utils.js";
import {
	buildConfig,
	buildLocalConfig,
	buildTeamsConfig,
	findTeamKey,
	findUserKey,
	type LinearCycle,
	type LinearLabel,
	type LinearState,
	type LinearTeam,
	type LinearUser,
} from "../config-builder.js";
import { showPluginInstallInstructions, updateGitignore } from "./file-ops.js";
import {
	promptForApiKey,
	selectCompletionMode,
	selectDevTeam,
	selectDevTestingStatus,
	selectQaPmTeams,
	selectStatusMappings,
} from "./linear-prompts.js";
import {
	selectLabelFilter,
	selectStatusSource,
	selectUser,
} from "./prompts.js";
import type { InitOptions, InitPaths } from "./types.js";

export async function initLinear(
	options: InitOptions,
	paths: InitPaths,
): Promise<void> {
	// Get API key
	const apiKey = await promptForApiKey(options);
	if (!apiKey) {
		console.error("Error: LINEAR_API_KEY is required.");
		console.error("Get your API key from: https://linear.app/settings/api");
		process.exit(1);
	}

	// Create Linear client
	const client = getLinearClient();

	console.log("\n📡 Fetching data from Linear...");

	// Fetch teams
	const teamsData = await client.teams();
	const teams = teamsData.nodes as LinearTeam[];

	if (teams.length === 0) {
		console.error("Error: No teams found in your Linear workspace.");
		process.exit(1);
	}

	// Select dev team (single selection)
	const devTeam = await selectDevTeam(teams, options);
	console.log(`  Dev Team: ${devTeam.name}`);

	// Fetch data from ALL teams (not just primary) to support cross-team operations
	console.log(`  Fetching data from ${teams.length} teams...`);

	// Collect users from all teams, but labels only from primary team
	// States are stored per-team for status mapping selection
	const allUsers: LinearUser[] = [];
	const allLabels: LinearLabel[] = [];
	const allStates: LinearState[] = [];
	const teamStatesMap = new Map<string, LinearState[]>(); // team.id -> states
	const seenUserIds = new Set<string>();
	const seenLabelIds = new Set<string>();
	const seenStateIds = new Set<string>();

	for (const team of teams) {
		try {
			const teamData = await client.team(team.id);
			const members = await teamData.members();
			for (const user of members.nodes as LinearUser[]) {
				if (!seenUserIds.has(user.id)) {
					seenUserIds.add(user.id);
					allUsers.push(user);
				}
			}

			// Labels: only from dev team
			if (team.id === devTeam.id) {
				const labelsData = await client.issueLabels({
					filter: { team: { id: { eq: team.id } } },
				});
				for (const label of labelsData.nodes as LinearLabel[]) {
					if (!seenLabelIds.has(label.id)) {
						seenLabelIds.add(label.id);
						allLabels.push(label);
					}
				}
			}

			// States: store per-team and also collect all
			const statesData = await client.workflowStates({
				filter: { team: { id: { eq: team.id } } },
			});
			const teamStates: LinearState[] = [];
			for (const state of statesData.nodes as LinearState[]) {
				teamStates.push(state);
				if (!seenStateIds.has(state.id)) {
					seenStateIds.add(state.id);
					allStates.push(state);
				}
			}
			teamStatesMap.set(team.id, teamStates);
		} catch {
			console.warn(
				`  ⚠ Could not fetch data for team ${team.name}, skipping...`,
			);
		}
	}

	const users = allUsers;
	const labels = allLabels;
	const states = allStates;

	// Get team-specific states for status mapping
	const devTeamStates = teamStatesMap.get(devTeam.id) || [];

	console.log(`  Users: ${users.length}`);
	console.log(`  Labels: ${labels.length} (from ${devTeam.name})`);
	console.log(`  Workflow states: ${states.length}`);

	// Get cycle from dev team (for current work tracking)
	const selectedTeam = await client.team(devTeam.id);
	const currentCycle = (await selectedTeam.activeCycle) as LinearCycle | null;

	// User selections
	const currentUser = await selectUser(users, options);
	const defaultLabel = await selectLabelFilter(labels, options);
	const statusSource = await selectStatusSource(options);

	// Status transitions for dev team (todo, in_progress, done, blocked)
	const statusTransitions = await selectStatusMappings(devTeamStates, options);

	// Dev team testing status (for strict_review mode)
	const devTestingStatus = await selectDevTestingStatus(devTeamStates, options);

	// Build preliminary teams config for selectQaPmTeams
	const teamsConfig = buildTeamsConfig(teams);

	// QA/PM teams selection (multiple, each with its own testing status)
	const qaPmTeams = await selectQaPmTeams(
		teams,
		devTeam,
		teamStatesMap,
		teamsConfig,
		options,
	);

	// Completion mode selection
	const completionMode = await selectCompletionMode(
		qaPmTeams.length > 0,
		options,
	);

	// Build config
	const config = buildConfig(
		teams,
		users,
		labels,
		states,
		statusTransitions,
		currentCycle ?? undefined,
	);

	// Add source config for Linear
	config.source = { type: "linear" };

	// Find keys
	const currentUserKey = findUserKey(config.users, currentUser.id);
	const devTeamKey = findTeamKey(config.teams, devTeam.id);

	const localConfig = buildLocalConfig(
		currentUserKey,
		devTeamKey,
		devTestingStatus,
		qaPmTeams,
		completionMode,
		defaultLabel,
		undefined, // excludeLabels
		statusSource,
	);

	// Write config files
	console.log("\n📝 Writing configuration files...");
	await fs.mkdir(paths.baseDir, { recursive: true });

	// Check for existing config
	const configExists = await fileExists(paths.configPath);
	const localExists = await fileExists(paths.localPath);

	// Merge with existing config if exists
	if (configExists && !options.force) {
		try {
			const existingContent = await fs.readFile(paths.configPath, "utf-8");
			const existingConfig = decode(existingContent) as unknown as Config;

			if (existingConfig.cycle_history) {
				config.cycle_history = existingConfig.cycle_history;
			}
			if (!currentCycle && existingConfig.current_cycle) {
				config.current_cycle = existingConfig.current_cycle;
			}
			if (existingConfig.priority_order) {
				config.priority_order = existingConfig.priority_order;
			}
		} catch {
			// Ignore merge errors
		}
	}

	await fs.writeFile(paths.configPath, encode(config), "utf-8");
	console.log(`  ✓ ${paths.configPath}`);

	// Merge local config
	if (localExists && !options.force) {
		try {
			const existingContent = await fs.readFile(paths.localPath, "utf-8");
			const existingLocal = decode(existingContent) as unknown as LocalConfig;

			if (!options.interactive) {
				if (existingLocal.current_user)
					localConfig.current_user = existingLocal.current_user;
				if (existingLocal.team) localConfig.team = existingLocal.team;
				if (existingLocal.dev_testing_status)
					localConfig.dev_testing_status = existingLocal.dev_testing_status;
				if (existingLocal.qa_pm_teams)
					localConfig.qa_pm_teams = existingLocal.qa_pm_teams;
				if (existingLocal.completion_mode)
					localConfig.completion_mode = existingLocal.completion_mode;
				if (existingLocal.labels) localConfig.labels = existingLocal.labels;
				if (existingLocal.exclude_labels)
					localConfig.exclude_labels = existingLocal.exclude_labels;
				if (existingLocal.status_source)
					localConfig.status_source = existingLocal.status_source;
			}
		} catch {
			// Ignore merge errors
		}
	}

	await fs.writeFile(paths.localPath, encode(localConfig), "utf-8");
	console.log(`  ✓ ${paths.localPath}`);

	// Update .gitignore (always use relative path .ttt)
	await updateGitignore(".ttt", options.interactive ?? true);

	// Summary
	console.log("\n✅ Initialization complete!\n");
	console.log("Configuration summary:");
	console.log(`  Dev Team: ${devTeam.name}`);
	console.log(
		`  User: ${currentUser.displayName || currentUser.name} (${currentUser.email})`,
	);
	console.log(
		`  Label filters: ${defaultLabel && defaultLabel.length > 0 ? defaultLabel.join(", ") : "(none)"}`,
	);
	console.log(
		`  Status source: ${statusSource === "local" ? "local (use 'sync --update' to push)" : "remote (immediate sync)"}`,
	);
	console.log(`  Completion mode: ${completionMode}`);
	if (devTestingStatus) {
		console.log(`  Dev testing status: ${devTestingStatus}`);
	}
	if (qaPmTeams.length > 0) {
		console.log(`  QA/PM teams:`);
		for (const qaPmTeam of qaPmTeams) {
			console.log(`    - ${qaPmTeam.team}: ${qaPmTeam.testing_status}`);
		}
	}
	console.log(`  (Use 'ttt config filters' to set excluded labels/users)`);
	if (currentCycle) {
		console.log(
			`  Cycle: ${currentCycle.name || `Cycle #${currentCycle.number}`}`,
		);
	}
	console.log(`  Status mappings:`);
	console.log(`    Todo: ${statusTransitions.todo}`);
	console.log(`    In Progress: ${statusTransitions.in_progress}`);
	console.log(`    Done: ${statusTransitions.done}`);
	if (statusTransitions.blocked) {
		console.log(`    Blocked: ${statusTransitions.blocked}`);
	}

	console.log("\nNext steps:");
	if (!process.env.LINEAR_API_KEY) {
		// Show partial key for confirmation (first 12 chars + masked)
		const maskedKey = `${apiKey.slice(0, 12)}...${"*".repeat(8)}`;
		console.log("  1. Set LINEAR_API_KEY in your shell profile:");
		console.log(`     export LINEAR_API_KEY="${maskedKey}"`);
		console.log("  2. Run sync: ttt sync");
		console.log("  3. Start working: ttt work-on");
	} else {
		console.log("  1. Run sync: ttt sync");
		console.log("  2. Start working: ttt work-on");
	}

	// Show Claude Code plugin installation instructions at the end
	showPluginInstallInstructions();
}
