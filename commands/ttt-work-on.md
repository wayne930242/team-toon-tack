---
name: ttt:work-on
description: Claim Linear/Trello ticket(s) and work on them
arguments:
  - name: issue-ids
    description: "One or more issue IDs (e.g., MP-624 MP-625), or 'next' / 'next <n>' for auto-select. Defaults to 'next'."
    required: false
  - name: dry-run
    description: Preview selection without changing status
    required: false
---

<law>
YOU MUST execute the `ttt claim` command using the Bash tool.
DO NOT manually edit cycle.toon or change task status by other means.
After each task is completed, YOU MUST execute `/ttt:done -m "summary"`. This is MANDATORY.
</law>

# /ttt:work-on — Claim a Ticket and Work on It

`ttt claim` is the command; `ttt work-on` is its alias. Claiming moves the ticket
to in-progress locally and on the remote source.

## Execution

```bash
ttt claim {{ issue-ids | default: "next" }} {{ "--dry-run" if dry-run }}
```

### Argument Resolution

| Input | Command |
|-------|---------|
| (none) | `ttt claim next` |
| `next` | `ttt claim next` |
| `next 3` | `ttt claim next 3` |
| `MP-624` | `ttt claim MP-624` |
| `MP-624 MP-625` | `ttt claim MP-624 MP-625` |
| `--dry-run` | `ttt claim next --dry-run` |
| `MP-624 --dry-run` | `ttt claim MP-624 --dry-run` |

## Full CLI Reference

```
Usage: ttt claim [issue-id...] [options]

Claim ticket(s): move them to in-progress locally and on the remote source.
Alias: ttt work-on

Arguments:
  issue-id    One or more issue IDs (e.g., MP-624 MP-625)
              'next' claims the highest priority pending task
              'next <n>' claims the top <n> pending tasks
              If omitted, shows interactive multi-select

Options:
  --dry-run   Pick tickets without changing status (preview only)
```

Tickets that are already completed, in review, or blocked are reported and
skipped without stopping the rest of the batch. An unknown ID aborts before
anything is claimed.

## After Claiming — Delegate the Implementation

This command claims the tickets. The implementation workflow belongs to the user.

**Use the user's own workflow whenever one exists** — routing or laws in their root `CLAUDE.md`, the project `CLAUDE.md`, or a `work-on` / `start-work` skill. Follow it as written and add nothing.

**Only when none exists**, run this minimal loop:

- Branch using the repo's existing naming convention.
- State a short plan before coding; for unclear scope or 3+ files, settle the scope with the user first.
- Write the failing test first, then the minimal code to pass it.
- Run lint / type / test and report the real output before claiming completion.
- Offer `/ttt:write-work-on-skill` to capture this project's commands as a reusable skill.

When several tickets were claimed at once, carry them one at a time and close
each with `/ttt:done -m "summary"` before starting the next.

## Error Handling

| Error | Solution |
|-------|----------|
| `No cycle data found` | Run `ttt sync` first |
| `No eligible tasks` | All tasks assigned or in-review; run `ttt sync` to refresh |
| `Issue not found` | Run `ttt sync <id>` to fetch it |
