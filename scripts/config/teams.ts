import prompts from "prompts";
import { getDefaultStatusTransitions } from "../lib/config-builder.js";
import {
	type CompletionMode,
	type Config,
	getLinearClient,
	type LocalConfig,
	type QaPmTeamConfig,
	saveLocalConfig,
} from "../utils.js";

interface LinearState {
	id: string;
	name: string;
	type: string;
}

export async function configureTeams(
	_config: Config,
	localConfig: LocalConfig,
): Promise<void> {
	console.log("👥 Configure Teams\n");

	const client = getLinearClient();
	const teamsData = await client.teams();
	const teams = teamsData.nodes;

	if (teams.length === 0) {
		console.error("No teams found.");
		process.exit(1);
	}

	// Build team key mapping
	const teamKeyMap = new Map<string, string>(); // id -> key
	for (const team of teams) {
		const key = team.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
		teamKeyMap.set(team.id, key);
	}

	// Fetch workflow states for all teams
	const teamStatesMap = new Map<string, LinearState[]>();
	for (const team of teams) {
		try {
			const statesData = await client.workflowStates({
				filter: { team: { id: { eq: team.id } } },
			});
			teamStatesMap.set(team.id, statesData.nodes as LinearState[]);
		} catch {
			teamStatesMap.set(team.id, []);
		}
	}

	// 1. Select dev team (single)
	console.log("\n👨‍💻 Dev Team:");
	const devTeamResponse = await prompts({
		type: "select",
		name: "teamId",
		message: "Select your dev team:",
		choices: teams.map((t) => {
			const key = teamKeyMap.get(t.id) || "";
			return {
				title: t.name,
				value: t.id,
				selected: key === localConfig.team,
			};
		}),
	});

	const devTeamId = devTeamResponse.teamId;
	const devTeamKey = teamKeyMap.get(devTeamId) || localConfig.team;
	const devTeam = teams.find((t) => t.id === devTeamId);

	// 2. Select dev team testing status
	const devStates = teamStatesMap.get(devTeamId) || [];
	const devDefaults = getDefaultStatusTransitions(devStates);

	console.log("\n🔍 Dev Team Testing/Review Status:");
	const devTestingResponse = await prompts({
		type: "select",
		name: "testingStatus",
		message: "Select testing/review status for dev team:",
		choices: [
			{ title: "(Skip - no testing status)", value: undefined },
			...devStates.map((s) => ({
				title: `${s.name} (${s.type})`,
				value: s.name,
			})),
		],
		initial: localConfig.dev_testing_status
			? devStates.findIndex((s) => s.name === localConfig.dev_testing_status) +
				1
			: devDefaults.testing
				? devStates.findIndex((s) => s.name === devDefaults.testing) + 1
				: 0,
	});

	const devTestingStatus = devTestingResponse.testingStatus;

	// 3. Select QA/PM teams (multiple)
	const otherTeams = teams.filter((t) => t.id !== devTeamId);
	const qaPmTeams: QaPmTeamConfig[] = [];

	if (otherTeams.length > 0) {
		console.log("\n🔗 QA/PM Teams:");
		const qaPmResponse = await prompts({
			type: "multiselect",
			name: "teamIds",
			message:
				"Select QA/PM teams for cross-team parent updates (space to select):",
			choices: otherTeams.map((t) => {
				const key = teamKeyMap.get(t.id) || "";
				const currentQaPm = localConfig.qa_pm_teams || [];
				return {
					title: t.name,
					value: t.id,
					selected: currentQaPm.some((qp) => qp.team === key),
				};
			}),
			hint: "- Press space to select, enter to confirm. Leave empty to skip.",
		});

		const selectedQaPmIds = qaPmResponse.teamIds || [];

		// 4. For each QA/PM team, select testing status
		for (const teamId of selectedQaPmIds) {
			const team = teams.find((t) => t.id === teamId);
			if (!team) continue;

			const teamKey = teamKeyMap.get(teamId) || "";
			const teamStates = teamStatesMap.get(teamId) || [];
			const defaults = getDefaultStatusTransitions(teamStates);

			// Find existing config for this team
			const existingConfig = localConfig.qa_pm_teams?.find(
				(qp) => qp.team === teamKey,
			);

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
				initial: existingConfig?.testing_status
					? stateChoices.findIndex(
							(c) => c.value === existingConfig.testing_status,
						) + 1
					: defaults.testing
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
	}

	// 5. Select completion mode
	console.log("\n✅ Completion Mode:");
	const currentMode =
		localConfig.completion_mode ||
		(qaPmTeams.length > 0 ? "upstream_strict" : "simple");
	const defaultModeIndex =
		currentMode === "simple"
			? 0
			: currentMode === "strict_review"
				? 1
				: currentMode === "upstream_strict"
					? 2
					: 3;

	const modeResponse = await prompts({
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
		initial: defaultModeIndex,
	});

	const completionMode: CompletionMode =
		modeResponse.mode || (qaPmTeams.length > 0 ? "upstream_strict" : "simple");

	// Update local config
	localConfig.team = devTeamKey;
	localConfig.dev_testing_status = devTestingStatus;
	localConfig.qa_pm_teams = qaPmTeams.length > 0 ? qaPmTeams : undefined;
	localConfig.completion_mode = completionMode;

	// Remove deprecated fields
	delete localConfig.teams;
	delete (localConfig as unknown as Record<string, unknown>).qa_pm_team;

	await saveLocalConfig(localConfig);

	console.log("\n✅ Teams updated:");
	console.log(`  Dev Team: ${devTeam?.name || devTeamKey}`);
	if (devTestingStatus) {
		console.log(`  Dev Testing Status: ${devTestingStatus}`);
	}
	console.log(`  Completion Mode: ${completionMode}`);
	if (qaPmTeams.length > 0) {
		console.log("  QA/PM Teams:");
		for (const qp of qaPmTeams) {
			console.log(`    - ${qp.team}: ${qp.testing_status}`);
		}
	}
}
