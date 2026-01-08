import type { Config, LocalConfig } from "../utils.js";

export function showConfig(config: Config, localConfig: LocalConfig): void {
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

	// Status Mappings
	console.log("\nStatus Mappings:");
	if (config.status_transitions) {
		const st = config.status_transitions;
		console.log(`  Todo: ${st.todo}`);
		console.log(`  In Progress: ${st.in_progress}`);
		console.log(`  Done: ${st.done}`);
		if (st.testing) {
			console.log(`  Testing: ${st.testing}`);
		}
	} else {
		console.log("  (not configured)");
	}
}
