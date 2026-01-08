#!/usr/bin/env bun
import prompts from "prompts";
import {
	getLinearClient,
	getTeamId,
	loadConfig,
	loadLocalConfig,
	type StatusTransitions,
	saveConfig,
	saveLocalConfig,
} from "./utils.js";

async function config() {
	const args = process.argv.slice(2);

	// Handle help flag
	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt config [subcommand]

Subcommands:
  show      Show current configuration
  status    Configure status mappings (todo, in_progress, done, testing)
  filters   Configure filters (label, exclude_labels, exclude_assignees)
  teams     Configure team selection

Examples:
  ttt config                # Show current config
  ttt config show           # Show current config
  ttt config status         # Configure status mappings
  ttt config filters        # Configure filter settings
  ttt config teams          # Configure team selection`);
		process.exit(0);
	}

	const subcommand = args[0] || "show";
	const configData = await loadConfig();
	const localConfig = await loadLocalConfig();

	if (subcommand === "show") {
		console.log("📋 Current Configuration:\n");

		// Teams
		console.log("Teams:");
		if (localConfig.teams && localConfig.teams.length > 0) {
			console.log(`  Selected: ${localConfig.teams.join(", ")}`);
			console.log(`  Primary: ${localConfig.team}`);
		} else {
			console.log(`  ${localConfig.team}`);
		}

		// User
		console.log(`\nUser: ${localConfig.current_user}`);

		// Filters
		console.log("\nFilters:");
		console.log(`  Label: ${localConfig.label || "(all)"}`);
		console.log(
			`  Exclude labels: ${localConfig.exclude_labels?.join(", ") || "(none)"}`,
		);
		console.log(
			`  Exclude users: ${localConfig.exclude_assignees?.join(", ") || "(none)"}`,
		);

		// Status Mappings
		console.log("\nStatus Mappings:");
		if (configData.status_transitions) {
			const st = configData.status_transitions;
			console.log(`  Todo: ${st.todo}`);
			console.log(`  In Progress: ${st.in_progress}`);
			console.log(`  Done: ${st.done}`);
			if (st.testing) {
				console.log(`  Testing: ${st.testing}`);
			}
		} else {
			console.log("  (not configured)");
		}
		process.exit(0);
	}

	if (subcommand === "status") {
		console.log("📊 Configure Status Mappings\n");

		const client = getLinearClient();
		const teamId = getTeamId(configData, localConfig.team);

		// Fetch workflow states
		const statesData = await client.workflowStates({
			filter: { team: { id: { eq: teamId } } },
		});
		const states = statesData.nodes;

		if (states.length === 0) {
			console.error("No workflow states found for this team.");
			process.exit(1);
		}

		const stateChoices = states.map((s) => ({
			title: `${s.name} (${s.type})`,
			value: s.name,
		}));

		// Get current values or defaults
		const current = configData.status_transitions || ({} as StatusTransitions);
		const defaultTodo =
			current.todo ||
			states.find((s) => s.type === "unstarted")?.name ||
			"Todo";
		const defaultInProgress =
			current.in_progress ||
			states.find((s) => s.type === "started")?.name ||
			"In Progress";
		const defaultDone =
			current.done ||
			states.find((s) => s.type === "completed")?.name ||
			"Done";
		const defaultTesting =
			current.testing || states.find((s) => s.name === "Testing")?.name;

		const todoResponse = await prompts({
			type: "select",
			name: "todo",
			message: 'Select status for "Todo" (pending tasks):',
			choices: stateChoices,
			initial: stateChoices.findIndex((c) => c.value === defaultTodo),
		});

		const inProgressResponse = await prompts({
			type: "select",
			name: "in_progress",
			message: 'Select status for "In Progress" (working tasks):',
			choices: stateChoices,
			initial: stateChoices.findIndex((c) => c.value === defaultInProgress),
		});

		const doneResponse = await prompts({
			type: "select",
			name: "done",
			message: 'Select status for "Done" (completed tasks):',
			choices: stateChoices,
			initial: stateChoices.findIndex((c) => c.value === defaultDone),
		});

		// Testing is optional
		const testingChoices = [
			{ title: "(None)", value: undefined },
			...stateChoices,
		];
		const testingResponse = await prompts({
			type: "select",
			name: "testing",
			message: 'Select status for "Testing" (optional, for parent tasks):',
			choices: testingChoices,
			initial: defaultTesting
				? testingChoices.findIndex((c) => c.value === defaultTesting)
				: 0,
		});

		const statusTransitions: StatusTransitions = {
			todo: todoResponse.todo || defaultTodo,
			in_progress: inProgressResponse.in_progress || defaultInProgress,
			done: doneResponse.done || defaultDone,
			testing: testingResponse.testing,
		};

		configData.status_transitions = statusTransitions;
		await saveConfig(configData);

		console.log("\n✅ Status mappings updated:");
		console.log(`  Todo: ${statusTransitions.todo}`);
		console.log(`  In Progress: ${statusTransitions.in_progress}`);
		console.log(`  Done: ${statusTransitions.done}`);
		if (statusTransitions.testing) {
			console.log(`  Testing: ${statusTransitions.testing}`);
		}
	}

	if (subcommand === "filters") {
		console.log("🔍 Configure Filters\n");

		const client = getLinearClient();
		const teamId = getTeamId(configData, localConfig.team);

		// Fetch labels
		const labelsData = await client.issueLabels({
			filter: { team: { id: { eq: teamId } } },
		});
		const labels = labelsData.nodes;

		// Fetch users
		const team = await client.team(teamId);
		const members = await team.members();
		const users = members.nodes;

		// Label filter (optional)
		const labelChoices = [
			{ title: "(No filter - sync all labels)", value: "" },
			...labels.map((l) => ({ title: l.name, value: l.name })),
		];
		const labelResponse = await prompts({
			type: "select",
			name: "label",
			message: "Select label filter (optional):",
			choices: labelChoices,
			initial: localConfig.label
				? labelChoices.findIndex((c) => c.value === localConfig.label)
				: 0,
		});

		// Exclude labels
		const excludeLabelsResponse = await prompts({
			type: "multiselect",
			name: "excludeLabels",
			message: "Select labels to exclude (space to select):",
			choices: labels.map((l) => ({
				title: l.name,
				value: l.name,
				selected: localConfig.exclude_labels?.includes(l.name),
			})),
		});

		// Exclude users
		const excludeUsersResponse = await prompts({
			type: "multiselect",
			name: "excludeUsers",
			message: "Select users to exclude (space to select):",
			choices: users.map((u) => {
				const key = (
					u.displayName ||
					u.name ||
					u.email?.split("@")[0] ||
					"user"
				)
					.toLowerCase()
					.replace(/[^a-z0-9]/g, "_");
				return {
					title: `${u.displayName || u.name} (${u.email})`,
					value: key,
					selected: localConfig.exclude_assignees?.includes(key),
				};
			}),
		});

		localConfig.label = labelResponse.label || undefined;
		localConfig.exclude_labels =
			excludeLabelsResponse.excludeLabels?.length > 0
				? excludeLabelsResponse.excludeLabels
				: undefined;
		localConfig.exclude_assignees =
			excludeUsersResponse.excludeUsers?.length > 0
				? excludeUsersResponse.excludeUsers
				: undefined;

		await saveLocalConfig(localConfig);

		console.log("\n✅ Filters updated:");
		console.log(`  Label: ${localConfig.label || "(all)"}`);
		console.log(
			`  Exclude labels: ${localConfig.exclude_labels?.join(", ") || "(none)"}`,
		);
		console.log(
			`  Exclude users: ${localConfig.exclude_assignees?.join(", ") || "(none)"}`,
		);
	}

	if (subcommand === "teams") {
		console.log("👥 Configure Teams\n");

		const client = getLinearClient();
		const teamsData = await client.teams();
		const teams = teamsData.nodes;

		if (teams.length === 0) {
			console.error("No teams found.");
			process.exit(1);
		}

		// Multi-select teams
		const teamsResponse = await prompts({
			type: "multiselect",
			name: "teamKeys",
			message: "Select teams to sync (space to select):",
			choices: teams.map((t) => {
				const key = t.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
				const currentTeams = localConfig.teams || [localConfig.team];
				return {
					title: t.name,
					value: key,
					selected: currentTeams.includes(key),
				};
			}),
			min: 1,
		});

		const selectedTeamKeys = teamsResponse.teamKeys || [localConfig.team];

		// If multiple teams, ask for primary
		let primaryTeam = localConfig.team;
		if (selectedTeamKeys.length > 1) {
			const primaryResponse = await prompts({
				type: "select",
				name: "primary",
				message: "Select primary team:",
				choices: selectedTeamKeys.map((key: string) => ({
					title: key,
					value: key,
				})),
				initial: selectedTeamKeys.indexOf(localConfig.team),
			});
			primaryTeam = primaryResponse.primary || selectedTeamKeys[0];
		} else {
			primaryTeam = selectedTeamKeys[0];
		}

		localConfig.team = primaryTeam;
		localConfig.teams =
			selectedTeamKeys.length > 1 ? selectedTeamKeys : undefined;

		await saveLocalConfig(localConfig);

		console.log("\n✅ Teams updated:");
		if (localConfig.teams) {
			console.log(`  Selected: ${localConfig.teams.join(", ")}`);
			console.log(`  Primary: ${localConfig.team}`);
		} else {
			console.log(`  Team: ${localConfig.team}`);
		}
	}
}

config().catch(console.error);
