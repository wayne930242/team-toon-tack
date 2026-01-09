#!/usr/bin/env bun
/**
 * ttt init - Initialize configuration files
 * Entry point that delegates to source-specific initialization
 */

import { confirm } from "@inquirer/prompts";
import {
	type InitPaths,
	initLinear,
	initTrello,
	parseArgs,
	printHelp,
	selectTaskSource,
} from "./lib/init/index.js";
import { fileExists, getPaths } from "./utils.js";

async function init() {
	const args = process.argv.slice(2);

	// Handle help flag early
	if (args.includes("--help") || args.includes("-h")) {
		printHelp();
		process.exit(0);
	}

	const options = parseArgs(args);
	const paths = getPaths();

	// Convert paths to InitPaths format
	const initPaths: InitPaths = {
		baseDir: paths.baseDir,
		configPath: paths.configPath,
		localPath: paths.localPath,
		cyclePath: paths.cyclePath,
		outputPath: paths.outputPath,
	};

	console.log("🚀 Team Toon Tack Initialization\n");

	// Check existing files
	const configExists = await fileExists(paths.configPath);
	const localExists = await fileExists(paths.localPath);

	if ((configExists || localExists) && !options.force) {
		console.log("Existing configuration found:");
		if (configExists) console.log(`  ✓ ${paths.configPath}`);
		if (localExists) console.log(`  ✓ ${paths.localPath}`);

		if (options.interactive) {
			const proceed = await confirm({
				message: "Update existing configuration?",
				default: true,
			});
			if (!proceed) {
				console.log("Cancelled.");
				process.exit(0);
			}
		} else {
			console.log("Use --force to overwrite existing files.");
			process.exit(1);
		}
	}

	// Select task source
	const source = await selectTaskSource(options);

	// Branch based on source
	if (source === "trello") {
		await initTrello(options, initPaths);
	} else {
		await initLinear(options, initPaths);
	}
}

init().catch(console.error);
