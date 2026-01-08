#!/usr/bin/env bun
import { resolve } from 'node:path';

const COMMANDS = ['init', 'sync', 'work-on', 'done', 'help', 'version'] as const;
type Command = typeof COMMANDS[number];

function printHelp() {
  console.log(`
team-toon-tack (ttt) - Linear task sync & management CLI

USAGE:
  ttt <command> [options]

COMMANDS:
  init      Initialize config files in current directory
  sync      Sync issues from Linear to local cycle.toon
  work-on   Start working on a task (interactive or by ID)
  done      Mark current task as completed
  help      Show this help message
  version   Show version

GLOBAL OPTIONS:
  -d, --dir <path>    Config directory (default: current directory)
                      Can also set via TOON_DIR environment variable

EXAMPLES:
  ttt init                      # Initialize in current directory
  ttt init -d ./team            # Initialize in ./team directory
  ttt sync                      # Sync from Linear
  ttt work-on                   # Interactive task selection
  ttt work-on MP-123            # Work on specific issue
  ttt work-on next              # Auto-select highest priority
  ttt done                      # Complete current task
  ttt done -m "Fixed the bug"   # With completion message

ENVIRONMENT:
  LINEAR_API_KEY    Required. Your Linear API key
  TOON_DIR          Optional. Default config directory

More info: https://github.com/wayne930242/team-toon-tack
`);
}

function printVersion() {
  console.log('team-toon-tack v1.0.0');
}

function parseGlobalArgs(args: string[]): { dir: string; commandArgs: string[] } {
  let dir = process.env.TOON_DIR || process.cwd();
  const commandArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-d' || arg === '--dir') {
      dir = resolve(args[++i] || '.');
    } else {
      commandArgs.push(arg);
    }
  }

  return { dir, commandArgs };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '-h' || args[0] === '--help') {
    printHelp();
    process.exit(0);
  }

  if (args[0] === 'version' || args[0] === '-v' || args[0] === '--version') {
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
  const scriptDir = new URL('../scripts/', import.meta.url).pathname;

  try {
    switch (command) {
      case 'init':
        process.argv = ['bun', 'init.ts', ...commandArgs];
        await import(`${scriptDir}init.ts`);
        break;
      case 'sync':
        await import(`${scriptDir}sync.ts`);
        break;
      case 'work-on':
        process.argv = ['bun', 'work-on.ts', ...commandArgs];
        await import(`${scriptDir}work-on.ts`);
        break;
      case 'done':
        process.argv = ['bun', 'done-job.ts', ...commandArgs];
        await import(`${scriptDir}done-job.ts`);
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
