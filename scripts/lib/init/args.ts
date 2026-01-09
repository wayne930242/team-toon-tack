/**
 * Command line argument parsing for init
 */

import { isValidSourceType } from "../adapters/index.js";
import type { InitOptions } from "./types.js";

export function parseArgs(args: string[]): InitOptions {
	const options: InitOptions = { interactive: true };

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		// Handle --key=value format
		if (arg.includes("=")) {
			const [key, value] = arg.split("=", 2);
			switch (key) {
				case "--source":
				case "-s":
					if (value && isValidSourceType(value)) {
						options.source = value;
					}
					break;
				case "--api-key":
				case "-k":
					options.apiKey = value;
					break;
				case "--trello-key":
					options.trelloApiKey = value;
					break;
				case "--trello-token":
					options.trelloToken = value;
					break;
				case "--user":
				case "-u":
					options.user = value;
					break;
				case "--team":
				case "-t":
					options.team = value;
					break;
				case "--label":
				case "-l":
					options.label = value;
					break;
			}
			continue;
		}

		// Handle --key value format
		switch (arg) {
			case "--source":
			case "-s": {
				const sourceArg = args[++i];
				if (sourceArg && isValidSourceType(sourceArg)) {
					options.source = sourceArg;
				}
				break;
			}
			case "--api-key":
			case "-k":
				options.apiKey = args[++i];
				break;
			case "--trello-key":
				options.trelloApiKey = args[++i];
				break;
			case "--trello-token":
				options.trelloToken = args[++i];
				break;
			case "--user":
			case "-u":
				options.user = args[++i];
				break;
			case "--team":
			case "-t":
				options.team = args[++i];
				break;
			case "--label":
			case "-l":
				options.label = args[++i];
				break;
			case "--force":
			case "-f":
				options.force = true;
				break;
			case "--yes":
			case "-y":
				options.interactive = false;
				break;
			case "--help":
			case "-h":
				printHelp();
				process.exit(0);
		}
	}

	return options;
}

export function printHelp(): void {
	console.log(`
ttt init - Initialize configuration files

USAGE:
  ttt init [OPTIONS]

OPTIONS:
  -s, --source <type>   Task source: "linear" (default) or "trello"
  -k, --api-key <key>   Linear API key (or set LINEAR_API_KEY env)
  --trello-key <key>    Trello API key (or set TRELLO_API_KEY env)
  --trello-token <tok>  Trello token (or set TRELLO_TOKEN env)
  -u, --user <email>    Your email/username
  -t, --team <name>     Team/Board name to sync
  -l, --label <name>    Default label filter (e.g., Frontend, Backend)
  -f, --force           Overwrite existing config files
  -y, --yes             Non-interactive mode (use defaults/provided args)
  -h, --help            Show this help message

EXAMPLES:
  ttt init                           # Interactive Linear setup
  ttt init --source=trello           # Interactive Trello setup
  ttt init --user alice@example.com --label Frontend
  ttt init -k lin_api_xxx -y
`);
}
