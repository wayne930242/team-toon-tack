import { checkbox, select } from "@inquirer/prompts";
import { getDefaultStatusTransitions } from "../lib/config-builder.js";
import {
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
	const devTeamId = await select({
		message: "Select your dev team:",
		choices: teams.map((t) => {
			const _key = teamKeyMap.get(t.id) || "";
			return {
				name: t.name,
				value: t.id,
			};
		}),
		default: teams.find((t) => teamKeyMap.get(t.id) === localConfig.team)?.id,
	});

	const devTeamKey = teamKeyMap.get(devTeamId) || localConfig.team;
	const devTeam = teams.find((t) => t.id === devTeamId);

	// 2. Select dev team testing status
	const devStates = teamStatesMap.get(devTeamId) || [];
	const devDefaults = getDefaultStatusTransitions(devStates);

	console.log("\n🔍 Dev Team Testing/Review Status:");
	const devTestingStatus = await select<string | undefined>({
		message: "Select testing/review status for dev team:",
		choices: [
			{ name: "(Skip - no testing status)", value: undefined },
			...devStates.map((s) => ({
				name: `${s.name} (${s.type})`,
				value: s.name,
			})),
		],
		default: localConfig.dev_testing_status || devDefaults.testing,
	});

	// 3. Select QA/PM teams (multiple)
	const otherTeams = teams.filter((t) => t.id !== devTeamId);
	const qaPmTeams: QaPmTeamConfig[] = [];

	if (otherTeams.length > 0) {
		console.log("\n🔗 QA/PM Teams:");
		const selectedQaPmIds = await checkbox({
			message:
				"Select QA/PM teams for cross-team parent updates (space to select):",
			choices: otherTeams.map((t) => {
				const key = teamKeyMap.get(t.id) || "";
				const currentQaPm = localConfig.qa_pm_teams || [];
				return {
					name: t.name,
					value: t.id,
					checked: currentQaPm.some((qp) => qp.team === key),
				};
			}),
		});

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
				name: `${s.name} (${s.type})`,
				value: s.name,
			}));

			const testingStatus = await select<string | undefined>({
				message: `Select testing status for ${team.name}:`,
				choices: [
					{ name: "(Skip this team)", value: undefined },
					...stateChoices,
				],
				default: existingConfig?.testing_status || defaults.testing,
			});

			if (testingStatus) {
				qaPmTeams.push({
					team: teamKey,
					testing_status: testingStatus,
				});
			}
		}
	}

	// 5. Select completion mode
	console.log("\n✅ Completion Mode:");
	const currentMode =
		localConfig.completion_mode ||
		(qaPmTeams.length > 0 ? "upstream_strict" : "simple");

	const completionMode = await select({
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
		default: currentMode,
	});

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
