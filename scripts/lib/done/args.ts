/**
 * Done module argument parsing
 */

import type { DoneArgs } from "./types.js";

export function parseArgs(args: string[]): DoneArgs {
	const issueIds: string[] = [];
	let message: string | undefined;
	let fromRemote = false;
	let commit: string | undefined;
	let repo: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "-m" || arg === "--message") {
			message = args[++i];
		} else if (arg === "--from-remote" || arg === "-r") {
			fromRemote = true;
		} else if (arg === "--commit" || arg === "--repo") {
			const value = args[++i];
			if (!value || value.startsWith("-")) {
				throw new Error(`${arg} requires a value.`);
			}
			if (arg === "--commit") commit = value;
			else repo = value;
		} else if (!arg.startsWith("-") && !issueIds.includes(arg)) {
			issueIds.push(arg);
		}
	}

	return { issueIds, message, fromRemote, commit, repo };
}

export function printHelp(): void {
	console.log(`Usage: ttt done [issue-id...] [-m message] [--from-remote] [--commit <sha>] [--repo <path>]

Arguments:
  issue-id          One or more issue IDs (e.g., MP-624 MP-625). Optional if only
                    one task is in-progress. With several IDs the options apply
                    to every ticket, each ticket gets a result line, a ticket
                    that is already done is reported and skipped, and the exit
                    code is non-zero when any ticket failed

Options:
  -m, --message     AI summary message describing the fix
  -r, --from-remote Fetch issue directly from Linear (bypasses local data check)
                    Use when issue exists in Linear but not in local sync data.
                    Also completes a ticket that is still Todo without 'ttt claim'
                    (no extra In Progress transition)
  --commit <sha>    Record this commit instead of the current HEAD
                    (for closing a ticket whose commit was merged earlier)
  --repo <path>     Git repository to read the commit from (default: cwd)

Examples:
  ttt done                         # Complete current in-progress task
  ttt done MP-624                  # Complete specific task
  ttt done -m "Fixed null check"   # With completion message
  ttt done MP-624 -m "Refactored"  # Specific task with message
  ttt done MP-624 MP-625 -m "Merged in v1.2.0"  # Several tickets, one message
  ttt done MP-624 --from-remote    # Complete issue fetched directly from Linear
  ttt done MP-624 --commit 1a2b3c4 # Record an earlier commit, not HEAD
  ttt done MP-624 --commit 1a2b3c4 --repo ~/projects/app`);
}
