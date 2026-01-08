# team-toon-tack (ttt)

[繁體中文](./README.zh-TW.md) | English

CLI tool for syncing and managing Linear issues with local TOON format.

## Installation

```bash
# npm (recommended)
npm install -g team-toon-tack

# Or with bun
bun add -g team-toon-tack

# Or use npx/bunx without installing
npx team-toon-tack <command>
bunx team-toon-tack <command>

# Short alias after global install
ttt <command>
```

## Quick Start

```bash
# 1. Set your Linear API key
export LINEAR_API_KEY="lin_api_xxxxx"

# 2. Initialize in your project
cd your-project
ttt init

# 3. Sync issues from Linear
ttt sync

# 4. Start working
ttt work-on
```

## Commands

### `ttt init`

Initialize configuration files in current directory.

```bash
ttt init                           # Interactive mode
ttt init --user alice@example.com  # Pre-select user
ttt init --label Frontend          # Set default label
ttt init --force                   # Overwrite existing config
ttt init -y                        # Non-interactive mode
```

### `ttt sync`

Sync current cycle issues from Linear.

```bash
ttt sync              # Sync all matching issues
ttt sync MP-123       # Sync only this specific issue
```

### `ttt work-on`

Start working on a task.

```bash
ttt work-on              # Interactive selection
ttt work-on MP-123       # Specific issue
ttt work-on next         # Auto-select highest priority
```

### `ttt done`

Mark task as completed.

```bash
ttt done                    # Auto-select if only one in-progress
ttt done MP-123             # Specific issue
ttt done -m "Fixed the bug" # With completion message
```

### `ttt status`

Show or modify task status.

```bash
ttt status              # Show current in-progress task
ttt status MP-123       # Show specific issue status
ttt status MP-123 --set +1      # Move to next status
ttt status MP-123 --set done    # Mark as done
ttt status --set pending        # Reset current task
```

Status options: `+1`, `-1`, `+2`, `-2`, `pending`, `in-progress`, `completed`, `blocked`, `todo`, `done`, `testing`

### `ttt config`

Configure settings.

```bash
ttt config              # Show current configuration
ttt config status       # Configure status mappings
ttt config filters      # Configure label/user filters
ttt config teams        # Configure multi-team selection
```

## Configuration

### Directory Structure

After `ttt init`, your project will have:

```
your-project/
└── .ttt/                  # Config directory
    ├── config.toon        # Team configuration (gitignore recommended)
    ├── local.toon         # Personal settings (gitignore)
    └── cycle.toon         # Current cycle data (gitignore, auto-generated)
```

### Custom Config Directory

```bash
# Use -d flag
ttt sync -d ./team

# Or set environment variable
export TOON_DIR=./team
ttt sync
```

### config.toon

Team-wide configuration (fetched from Linear):

```toon
teams:
  main:
    id: TEAM_UUID
    name: Team Name

users:
  alice:
    id: USER_UUID
    email: alice@example.com
    displayName: Alice

labels:
  frontend:
    id: LABEL_UUID
    name: Frontend

current_cycle:
  id: CYCLE_UUID
  name: Cycle #1
```

### local.toon

Personal settings:

```toon
current_user: alice
team: frontend
teams[2]:
  - frontend
  - backend
label: Frontend
exclude_labels[1]:
  - Bug
exclude_assignees[1]:
  - bob
```

| Field | Description |
|-------|-------------|
| `current_user` | Your user key from config.toon |
| `team` | Primary team key |
| `teams` | Multiple teams to sync (optional) |
| `label` | Filter issues by label (optional) |
| `exclude_labels` | Exclude issues with these labels (optional) |
| `exclude_assignees` | Hide issues from these users (optional) |

### config.toon - Status Mappings

Configure which Linear statuses map to local states:

```toon
status_transitions:
  todo: Todo
  in_progress: In Progress
  done: Done
  testing: Testing
```

Run `ttt config status` to configure interactively.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LINEAR_API_KEY` | **Required.** Your Linear API key |
| `TOON_DIR` | Config directory (default: current directory) |

## Integration Examples

### With Claude Code

```yaml
# .claude/commands/sync.md
---
description: Sync Linear issues
---
ttt sync -d team
```

### As Git Submodule

```bash
# Add config directory as submodule
git submodule add https://github.com/your-org/team-config.git team
cd team && ttt sync
```

### In package.json

```json
{
  "scripts": {
    "sync": "ttt sync -d team",
    "work": "ttt work-on -d team"
  }
}
```

## License

MIT
