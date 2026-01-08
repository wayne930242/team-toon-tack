import prompts from "prompts";
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

	localConfig.label = labelResponse.label || undefined;
	localConfig.exclude_labels =
		excludeLabelsResponse.excludeLabels?.length > 0
			? excludeLabelsResponse.excludeLabels
			: undefined;

	await saveLocalConfig(localConfig);

	console.log("\n✅ Filters updated:");
	console.log(`  Label: ${localConfig.label || "(all)"}`);
	console.log(
		`  Exclude labels: ${localConfig.exclude_labels?.join(", ") || "(none)"}`,
	);
}
