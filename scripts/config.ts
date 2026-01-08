#!/usr/bin/env bun
import { configureFilters } from "./config/filters.js";
import { showConfig } from "./config/show.js";
import { configureStatus } from "./config/status.js";
import { configureTeams } from "./config/teams.js";
import { loadConfig, loadLocalConfig } from "./utils.js";

async function config() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt config [subcommand]

Subcommands:
  show      Show current configuration
  status    Configure status mappings (todo, in_progress, done, testing)
  filters   Configure filters (label, exclude_labels)
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

	switch (subcommand) {
		case "show":
			showConfig(configData, localConfig);
			break;
		case "status":
			await configureStatus(configData, localConfig);
			break;
		case "filters":
			await configureFilters(configData, localConfig);
			break;
		case "teams":
			await configureTeams(configData, localConfig);
			break;
		default:
			console.error(`Unknown subcommand: ${subcommand}`);
			process.exit(1);
	}
}

config().catch(console.error);
