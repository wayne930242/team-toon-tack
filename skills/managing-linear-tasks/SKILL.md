---
name: managing-linear-tasks
description: Use when the user mentions Linear or Trello issues, references issue IDs like MP-123, or asks to sync, show, start, complete, or check status of tasks.
---

<law>
ALL task operations MUST go through the `ttt` CLI via Bash tool.
NEVER manually edit `.ttt/` files (cycle.toon, config.toon, local.toon).
NEVER fabricate issue data — always run the CLI to get real data.
After completing any task, MUST execute `/ttt:done -m "summary"`.
</law>

# Task Manager (Linear/Trello)

Manage developer task workflows using the `ttt` CLI.

## Command Router

Match user intent to the correct `/ttt:*` command:

| User Intent | Command | Example |
|-------------|---------|---------|
| Sync/fetch issues | `/ttt:sync` | "sync my issues", "pull from Linear" |
| Show/search issues | `/ttt:show` | "show MP-624", "list my tasks", "what issues do I have" |
| Start working on a task | `/ttt:work-on` | "work on next", "start MP-624" |
| Check/change status | `/ttt:status` | "what's my current task", "set MP-624 to blocked" |
| Complete a task | `/ttt:done` | "done", "mark complete", "finish task" |

**When a matching intent is detected, invoke the corresponding `/ttt:*` slash command.**

## Quick Reference

```bash
ttt sync                    # Sync Todo/In Progress issues
ttt sync --all              # Sync all statuses
ttt sync MP-624             # Sync specific issue
ttt show                    # List all local issues
ttt show MP-624             # Show issue details
ttt show --user me          # My issues
ttt work-on next            # Auto-select highest priority
ttt work-on MP-624          # Start specific task
ttt status                  # Current in-progress task
ttt status MP-624 --set +1  # Advance status
ttt done -m "summary"       # Complete with message
```

## Prerequisites

- **Linear**: `LINEAR_API_KEY` env var set
- **Trello**: `TRELLO_API_KEY` + `TRELLO_TOKEN` env vars set
- `.ttt/` directory initialized (`ttt init`)

## Standard Workflow

```
ttt sync → ttt work-on next → [implement] → git commit → ttt done -m "..."
```

## File Structure

```
.ttt/
├── config.toon     # Team configuration
├── local.toon      # Personal settings
├── cycle.toon      # Current cycle tasks (auto-generated)
└── output/         # Downloaded attachments
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No cycle data | `ttt sync` |
| Issue not found locally | `ttt show <id> --remote` or `ttt sync <id>` |
| API key not set | Set `LINEAR_API_KEY` or `TRELLO_API_KEY` + `TRELLO_TOKEN` |
| Stale data | `ttt sync` to refresh |
