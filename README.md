# team-toon-tack (ttt)

CLI tool for syncing and managing Linear issues with local TOON format.

## Installation

```bash
# Global install (recommended)
bun add -g team-toon-tack

# Or use npx
bunx team-toon-tack <command>

# Short alias
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
ttt sync
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

## Configuration

### Directory Structure

After `ttt init`, your project will have:

```
your-project/
├── config.toon    # Team configuration (gitignore recommended)
├── local.toon     # Personal settings (gitignore)
└── cycle.toon     # Current cycle data (gitignore, auto-generated)
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
label: Frontend
exclude_assignees[1]: bob
```

| Field | Description |
|-------|-------------|
| `current_user` | Your user key from config.toon |
| `label` | Filter issues by label (optional) |
| `exclude_assignees` | Hide issues from these users (optional) |

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
