#!/usr/bin/env bun
/**
 * ttt migrate --to linear - move the local board into a Linear team
 */
import { LinearClient } from "@linear/sdk";
import {
	MigrateBusyError,
	MigrateError,
	mappingPath,
	migrateToLinear,
} from "./lib/migrate/linear.js";
import {
	getPaths,
	getSourceType,
	loadConfig,
	loadLocalConfig,
} from "./utils.js";

const HELP = `Usage: ttt migrate --to linear [--team <key>] [--dry-run]

Move the local board (.ttt/local) into a Linear team: every issue with its
state, labels, priority, estimate, assignee, parent, comments, and
blocks/related relations. Labels missing in Linear are created; users are
matched by email, then by name (no match: unassigned).

Options:
  --to linear       Target source (only linear for now)
  --team <key>      Linear team key, name, or id (needed when the API key
                    sees more than one team)
  --dry-run         Show the plan; write nothing to Linear or .ttt

Work orders under .ttt/orders and the tasks in cycle.toon switch to the
Linear ids with the config, so 'ttt order' acts on the migrated issues.

Each step is recorded in .ttt/local/migration-linear.toon before it is sent,
with the id Linear will store, so a failed or interrupted run can be rerun:
it continues where it stopped and never creates an issue twice. config.toon
switches to Linear only after everything succeeded; the board stays as the
record of what was migrated. A run holds .ttt/local/migration.lock, so a
second run started meanwhile is refused. Needs LINEAR_API_KEY.

Examples:
  ttt migrate --to linear --dry-run
  ttt migrate --to linear --team ENG`;

interface MigrateArgs {
	to?: string;
	team?: string;
	dryRun: boolean;
}

function parseArgs(args: string[]): MigrateArgs {
	const parsed: MigrateArgs = { dryRun: false };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--dry-run") {
			parsed.dryRun = true;
		} else if (arg === "--to" || arg === "--team") {
			const value = args[++i];
			if (!value || value.startsWith("-")) {
				throw new MigrateError(`${arg} requires a value.`);
			}
			if (arg === "--to") parsed.to = value;
			else parsed.team = value;
		} else if (arg.startsWith("--to=")) {
			parsed.to = arg.slice("--to=".length);
		} else if (arg.startsWith("--team=")) {
			parsed.team = arg.slice("--team=".length);
		} else {
			throw new MigrateError(`Unknown argument: ${arg}`);
		}
	}
	return parsed;
}

async function migrate(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.includes("--help") || args.includes("-h")) {
		console.log(HELP);
		return;
	}
	const parsed = parseArgs(args);
	if (parsed.to !== "linear") {
		throw new MigrateError(
			parsed.to
				? `Cannot migrate to "${parsed.to}": only --to linear is supported.`
				: "Name the target: ttt migrate --to linear",
		);
	}

	const config = await loadConfig();
	const sourceType = getSourceType(config);
	if (sourceType !== "local") {
		throw new MigrateError(
			`This workspace's source is ${sourceType}; migrate moves a local board. (A finished migration leaves ${mappingPath()}.)`,
		);
	}
	const localConfig = await loadLocalConfig();

	const apiKey = process.env.LINEAR_API_KEY;
	if (!apiKey) {
		throw new MigrateError(
			'LINEAR_API_KEY is not set. Export it first: export LINEAR_API_KEY="lin_api_..."',
		);
	}

	const paths = getPaths();
	try {
		await migrateToLinear({
			client: new LinearClient({ apiKey }),
			config,
			localConfig,
			team: parsed.team,
			dryRun: parsed.dryRun,
			log: (line) => console.log(line),
			configPath: paths.configPath,
			localPath: paths.localPath,
			cyclePath: paths.cyclePath,
		});
	} catch (error) {
		if (!parsed.dryRun && !(error instanceof MigrateBusyError)) {
			console.error(
				"The source is still local. Nothing is lost: rerun the same command to continue where it stopped.",
			);
		}
		throw error;
	}

	if (!parsed.dryRun) {
		console.log(
			`\n✅ Migrated. config.toon now points at Linear; the mapping is in ${mappingPath()}.`,
		);
		console.log("Next: ttt sync");
	}
}

migrate().catch((error) => {
	console.error(`Error: ${error instanceof Error ? error.message : error}`);
	process.exitCode = 1;
});
