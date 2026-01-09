#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// When running from dist/bin/cli.js, we need to go up two levels to find package.json
const pkg = JSON.parse(
	readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"),
);
const VERSION = pkg.version;

const COMMANDS = [
	"init",
	"sync",
	"work-on",
	"done",
	"status",
	"show",
	"config",
	"help",
	"version",
] as const;
type Command = (typeof COMMANDS)[number];

function printHelp() {
	console.log(`
team-toon-tack (ttt) - Linear task sync & management CLI

USAGE:
  ttt <command> [options]

COMMANDS:
  init       Initialize config files in current directory
  sync       Sync issues from Linear to local cycle.ttt
  work-on    Start working on a task (interactive or by ID)
  done       Mark current task as completed
  status     Show or modify task status
  show       Show issue details or search issues by filters
  config     Configure settings (status mappings, filters)
  help       Show this help message
  version    Show version

GLOBAL OPTIONS:
  -d, --dir <path>    Config directory (default: .ttt)
                      Can also set via TOON_DIR environment variable

EXAMPLES:
  ttt init                      # Initialize .ttt directory
  ttt init -d ./custom          # Initialize in custom directory
  ttt sync                      # Sync from Linear
  ttt work-on                   # Interactive task selection
  ttt work-on MP-123            # Work on specific issue
  ttt work-on next              # Auto-select highest priority
  ttt done                      # Complete current task
  ttt done -m "Fixed the bug"   # With completion message
  ttt show MP-123               # Show issue from local data
  ttt show --label frontend     # Search local issues by label
  ttt show --status "In Progress"  # Filter by status

ENVIRONMENT:
  LINEAR_API_KEY    Required. Your Linear API key
  TOON_DIR          Optional. Default config directory

More info: https://github.com/wayne930242/team-toon-tack
`);
}

function printVersion() {
	console.log(`team-toon-tack v${VERSION}`);
}

function parseGlobalArgs(args: string[]): {
	dir: string;
	commandArgs: string[];
} {
	let dir = process.env.TOON_DIR || resolve(process.cwd(), ".ttt");
	const commandArgs: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "-d" || arg === "--dir") {
			dir = resolve(args[++i] || ".");
		} else {
			commandArgs.push(arg);
		}
	}

	return { dir, commandArgs };
}

async function main() {
	const args = process.argv.slice(2);

	if (
		args.length === 0 ||
		args[0] === "help" ||
		args[0] === "-h" ||
		args[0] === "--help"
	) {
		printHelp();
		process.exit(0);
	}

	if (args[0] === "version" || args[0] === "-v" || args[0] === "--version") {
		printVersion();
		process.exit(0);
	}

	const command = args[0] as Command;
	const restArgs = args.slice(1);
	const { dir, commandArgs } = parseGlobalArgs(restArgs);

	// Set TOON_DIR for scripts to use
	process.env.TOON_DIR = dir;

	if (!COMMANDS.includes(command)) {
		console.error(`Unknown command: ${command}`);
		console.error(`Run 'ttt help' for usage.`);
		process.exit(1);
	}

	// Import and run the appropriate script
	const scriptDir = new URL("../scripts/", import.meta.url).pathname;
	try {
		switch (command) {
			case "init":
				process.argv = ["node", "init.js", ...commandArgs];
				await import(`${scriptDir}init.js`);
				break;
			case "sync":
				await import(`${scriptDir}sync.js`);
				break;
			case "work-on":
				process.argv = ["node", "work-on.js", ...commandArgs];
				await import(`${scriptDir}work-on.js`);
				break;
			case "done":
				process.argv = ["node", "done-job.js", ...commandArgs];
				await import(`${scriptDir}done-job.js`);
				break;
			case "status":
				process.argv = ["node", "status.js", ...commandArgs];
				await import(`${scriptDir}status.js`);
				break;
			case "show":
				process.argv = ["node", "show.js", ...commandArgs];
				await import(`${scriptDir}show.js`);
				break;
			case "config":
				process.argv = ["node", "config.js", ...commandArgs];
				await import(`${scriptDir}config.js`);
				break;
		}
	} catch (error) {
		if (error instanceof Error) {
			console.error(`Error: ${error.message}`);
		}
		process.exit(1);
	}
}

main();
