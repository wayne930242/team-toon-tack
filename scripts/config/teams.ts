import prompts from "prompts";
import {
	type Config,
	getLinearClient,
	type LocalConfig,
	saveLocalConfig,
} from "../utils.js";

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
