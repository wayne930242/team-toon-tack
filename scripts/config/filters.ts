import { checkbox } from "@inquirer/prompts";
import {
	type Config,
	getLinearClient,
	getTeamId,
	type LocalConfig,
	saveLocalConfig,
} from "../utils.js";

export async function configureFilters(
	config: Config,
	localConfig: LocalConfig,
): Promise<void> {
	console.log("🔍 Configure Filters\n");

	const client = getLinearClient();
	const teamId = getTeamId(config, localConfig.team);

	// Fetch labels
	const labelsData = await client.issueLabels({
		filter: { team: { id: { eq: teamId } } },
	});
	const labels = labelsData.nodes;

	// Labels filter (multiselect, optional)
	const labelChoices = labels.map((l) => ({
		name: l.name,
		value: l.name,
		checked: localConfig.labels?.includes(l.name),
	}));
	const selectedLabels = await checkbox({
		message: "Select label filters (space to select, enter to confirm):",
		choices: labelChoices,
	});

	// Exclude labels
	const excludeLabelChoices = labels.map((l) => ({
		name: l.name,
		value: l.name,
		checked: localConfig.exclude_labels?.includes(l.name),
	}));
	const excludeLabels = await checkbox({
		message: "Select labels to exclude (space to select):",
		choices: excludeLabelChoices,
	});

	localConfig.labels = selectedLabels.length > 0 ? selectedLabels : undefined;
	localConfig.exclude_labels =
		excludeLabels.length > 0 ? excludeLabels : undefined;

	await saveLocalConfig(localConfig);

	console.log("\n✅ Filters updated:");
	console.log(`  Labels: ${localConfig.labels?.join(", ") || "(all)"}`);
	console.log(
		`  Exclude labels: ${localConfig.exclude_labels?.join(", ") || "(none)"}`,
	);
}
