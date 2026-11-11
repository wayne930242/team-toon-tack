---
name: managing-linear-tasks
description: Use when the user mentions Linear or Trello issues, mentions `ttt`, references issue IDs like MP-123, or asks to sync, show, start, complete, create, assign, edit, cancel, comment on, or check status of tasks, or to track a train batch of tickets in a work order (工單).
---

# Task Manager (Linear/Trello)

The instructions for this skill ship inside the `ttt` CLI, so they always match the installed version.

1. Before any `ttt` work, run `ttt skill managing-linear-tasks` with the shell tool and follow the printed text.
2. Its header lists sub-pages. For a work order (工單, a train batch of tickets), print the page for your side and follow it: `ttt skill managing-linear-tasks orders-coordinator` or `ttt skill managing-linear-tasks orders-integrator`.
3. `ttt skills` lists every bundled skill with the CLI version.

When `ttt skill` is an unknown command, the installed CLI is 3.13 or older: update it (`npm install -g team-toon-tack@latest`), and until then use `ttt help` and `ttt <command> --help`.
