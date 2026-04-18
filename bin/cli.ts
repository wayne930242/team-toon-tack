#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDotEnv, resolveLinearApiKey } from "../scripts/lib/env.js";

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
	"estimate",
	"done",
	"status",
	"show",
	"comment",
	"create",
	"assign",
	"edit",
	"cancel",
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
  estimate   Store a local human-effort estimate for a task
  done       Mark current task as completed
  status     Show or modify task status
  show       Show issue details or search issues by filters
  comment    Add a comment to an issue
  create     Create a new issue
  assign     Reassign an issue to a user
  edit       Edit issue fields (title, description, priority, labels)
  cancel     Cancel an issue
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
  ttt estimate MP-123 6         # Save a 6-hour estimate locally
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

	// Load .ttt/.env (if present) and resolve configured Linear API key env
	// var into LINEAR_API_KEY so downstream code is workspace-aware.
	// Skip the resolver for `init` so the workspace picker sees the raw
	// env — otherwise we'd mirror the previously-saved key over LINEAR_API_KEY
	// and the user's shell-level key would appear to point to the saved
	// workspace.
	await loadDotEnv(join(dir, ".env"));
	if (command !== "init") {
		await resolveLinearApiKey(join(dir, "local.toon"));
	}

	if (!COMMANDS.includes(command)) {
		console.error(`Unknown command: ${command}`);
		console.error(`Run 'ttt help' for usage.`);
		process.exit(1);
	}

	// Import and run the appropriate script
	const scriptDir = join(__dirname, "..", "scripts");
	const importScript = (name: string) =>
		import(pathToFileURL(join(scriptDir, name)).href);
	try {
		switch (command) {
			case "init":
				process.argv = ["node", "init.js", ...commandArgs];
				await importScript("init.js");
				break;
			case "sync":
				process.argv = ["node", "sync.js", ...commandArgs];
				await importScript("sync.js");
				break;
			case "work-on":
				process.argv = ["node", "work-on.js", ...commandArgs];
				await importScript("work-on.js");
				break;
			case "estimate":
				process.argv = ["node", "estimate.js", ...commandArgs];
				await importScript("estimate.js");
				break;
			case "done":
				process.argv = ["node", "done-job.js", ...commandArgs];
				await importScript("done-job.js");
				break;
			case "status":
				process.argv = ["node", "status.js", ...commandArgs];
				await importScript("status.js");
				break;
			case "show":
				process.argv = ["node", "show.js", ...commandArgs];
				await importScript("show.js");
				break;
			case "comment":
				process.argv = ["node", "comment.js", ...commandArgs];
				await importScript("comment.js");
				break;
			case "create":
				process.argv = ["node", "create.js", ...commandArgs];
				await importScript("create.js");
				break;
			case "assign":
				process.argv = ["node", "assign.js", ...commandArgs];
				await importScript("assign.js");
				break;
			case "edit":
				process.argv = ["node", "edit.js", ...commandArgs];
				await importScript("edit.js");
				break;
			case "cancel":
				process.argv = ["node", "cancel.js", ...commandArgs];
				await importScript("cancel.js");
				break;
			case "config":
				process.argv = ["node", "config.js", ...commandArgs];
				await importScript("config.js");
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
