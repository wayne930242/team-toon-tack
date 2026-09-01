---
name: ttt:work-on
description: Start working on a Linear task
arguments:
  - name: issue-id
    description: "Issue ID (e.g., MP-624) or 'next' for auto-select. Defaults to 'next'."
    required: false
  - name: dry-run
    description: Preview selection without changing status
    required: false
---

<law>
YOU MUST execute the `ttt work-on` command using the Bash tool.
DO NOT manually edit cycle.toon or change task status by other means.
After the task is completed, YOU MUST execute `/ttt:done -m "summary"`. This is MANDATORY.
</law>

# /ttt:work-on — Start Working on a Task

## Execution

```bash
ttt work-on {{ issue-id | default: "next" }} {{ "--dry-run" if dry-run }}
```

### Argument Resolution

| Input | Command |
|-------|---------|
| (none) | `ttt work-on next` |
| `next` | `ttt work-on next` |
| `MP-624` | `ttt work-on MP-624` |
| `--dry-run` | `ttt work-on next --dry-run` |
| `MP-624 --dry-run` | `ttt work-on MP-624 --dry-run` |

## Full CLI Reference

```
Usage: ttt work-on [issue-id] [options]

Arguments:
  issue-id    Issue ID (e.g., MP-624) or 'next' for auto-select
              If omitted, shows interactive selection

Options:
  --dry-run   Pick task without changing status (preview only)
```

## After Selection — Delegate the Implementation

This command picks the task. The implementation workflow belongs to the user.

**Use the user's own workflow whenever one exists** — routing or laws in their root `CLAUDE.md`, the project `CLAUDE.md`, or a `work-on` / `start-work` skill. Follow it as written and add nothing.

**Only when none exists**, run this minimal loop:

- Branch using the repo's existing naming convention.
- State a short plan before coding; for unclear scope or 3+ files, settle the scope with the user first.
- Write the failing test first, then the minimal code to pass it.
- Run lint / type / test and report the real output before claiming completion.
- Offer `/ttt:write-work-on-skill` to capture this project's commands as a reusable skill.

Either path closes the task with `/ttt:done -m "summary"`.

## Error Handling

| Error | Solution |
|-------|----------|
| `No cycle data found` | Run `ttt sync` first |
| `No eligible tasks` | All tasks assigned or in-review; run `ttt sync` to refresh |
| `Issue not found` | Run `ttt sync <id>` to fetch it |
