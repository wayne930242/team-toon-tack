---
name: ttt:sync
description: Sync Linear issues to local cycle data
arguments:
  - name: issue-id
    description: Optional specific issue ID to sync (e.g., MP-624)
    required: false
  - name: flags
    description: "Additional flags: --all (all statuses), --update (push local changes)"
    required: false
---

<law>
YOU MUST execute the `ttt sync` command using the Bash tool.
DO NOT simulate, summarize, or skip the command.
DO NOT manually edit cycle.toon or any .ttt/ files.
The CLI handles all syncing logic — your job is to run it and report the output.
</law>

# /ttt:sync — Sync Issues

## Execution

Build the command from arguments and run it:

```bash
ttt sync {{ issue-id }} {{ flags }}
```

### Argument Resolution

| Input | Command |
|-------|---------|
| (none) | `ttt sync` |
| `MP-624` | `ttt sync MP-624` |
| `--all` | `ttt sync --all` |
| `--update` | `ttt sync --update` |
| `MP-624 --all` | `ttt sync MP-624 --all` |

## Full CLI Reference

```
Usage: ttt sync [issue-id] [--all] [--update]

Arguments:
  issue-id    Optional. Sync only this specific issue (e.g., MP-624)

Options:
  --all       Sync all issues regardless of status (default: only Todo/In Progress)
  --update    Push local status changes to Linear (for local mode users)
```

## After Execution

Report to the user:
- Number of tasks synced
- Current cycle name
- Any errors encountered

## Error Handling

| Error | Solution |
|-------|----------|
| `LINEAR_API_KEY not set` | Ask user to set `LINEAR_API_KEY` environment variable |
| `No cycle data found` | Cycle may not exist in Linear; ask user to verify |
| `No config found` | Run `ttt init` first |
| Network error | Retry once, then report to user |
