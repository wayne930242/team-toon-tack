# team-toon-tack (ttt)

[繁體中文](./README.zh-TW.md) | English

Optimized Linear workflow for Claude Code — saves significant tokens compared to MCP.

## Features

- **Token Efficient** — Local cycle cache eliminates repeated API calls, saving significant tokens vs Linear MCP
- **Smart Task Selection** — Auto-pick highest priority unassigned work with `/work-on next`
- **Multi-team Support** — Sync and filter issues across multiple teams
- **Flexible Sync Modes** — Choose between remote (immediate Linear sync) or local (offline-first, sync later with `--update`)
- **Completion Modes** — Four modes for task completion: simple, strict review, upstream strict, upstream not strict
- **QA Team Support** — Auto-update parent issues in QA team to "Testing" when completing dev tasks
- **Attachment Download** — Auto-download Linear images and files to local `.ttt/output/` for AI vision analysis
- **Blocked Status** — Set tasks as blocked when waiting on external dependencies
- **Claude Code Plugin** — Install plugin for `/ttt:*` commands and auto-activated skills
- **Cycle History** — Local `.toon` files preserve cycle data for AI context
- **User Filtering** — Only see issues assigned to you or unassigned

## Quick Start

### 1. Install & Initialize

```bash
npm install -g team-toon-tack
export LINEAR_API_KEY="lin_api_xxxxx"

cd your-project
ttt init
```

During init, you'll configure:
- **Dev team**: Your development team (single selection)
- **Dev testing status**: Testing/review status for your dev team (optional)
- **QA team(s)**: For cross-team parent issue updates, each with its own testing status (optional)
- **Completion mode**: How task completion is handled (see below)
- **Status source**: `remote` (update Linear immediately) or `local` (work offline, sync with `ttt sync --update`)

### Completion Modes

| Mode | Behavior |
|------|----------|
| `simple` | Mark task as Done + parent as Done. Default when no QA team configured. |
| `strict_review` | Mark task to dev testing + parent to QA testing. |
| `upstream_strict` | Mark task as Done + parent to Testing. Falls back to dev testing if no parent. Default when QA team configured. |
| `upstream_not_strict` | Mark task as Done + parent to Testing. No fallback if no parent. |

### 2. Install Claude Code Plugin (Optional)

```
/plugin marketplace add wayne930242/team-toon-tack
/plugin install team-toon-tack@wayne930242
```

### 3. Daily Workflow

In Claude Code (with plugin installed):

```
/ttt:sync              # Fetch all Linear issues for current cycle
/ttt:work-on next      # Pick highest priority task & start working
/ttt:done              # Complete task with AI-generated summary
```

Or using CLI directly:

```bash
ttt sync
ttt work-on next
ttt done -m "Completed the task"
```

---

## CLI Reference

### `ttt init`

Initialize configuration in current directory.

```bash
ttt init                           # Interactive mode
ttt init --user alice@example.com  # Pre-select user
ttt init --label Frontend          # Set default label
ttt init --force                   # Overwrite existing config
```

### `ttt sync`

Sync current cycle issues from Linear.

```bash
ttt sync              # Sync all matching issues
ttt sync MP-123       # Sync specific issue only
ttt sync --update     # Push local status changes to Linear (for local mode)
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
ttt status MP-123 --set blocked # Set as blocked (waiting on dependency)
```

### `ttt show`

Show issue details or search issues from local cycle data.

```bash
ttt show                       # Show all issues in local cycle data
ttt show MP-123                # Show specific issue from local data
ttt show MP-123 --remote       # Fetch specific issue from Linear
ttt show --label frontend      # Filter by label
ttt show --status "In Progress" --user me   # My in-progress issues
ttt show --priority 1          # Show urgent issues
ttt show --export              # Export as markdown
```

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

```
your-project/
└── .ttt/
    ├── config.toon     # Team config (gitignore recommended)
    ├── local.toon      # Personal settings (gitignore)
    ├── cycle.toon      # Current cycle data (auto-generated)
    └── output/         # Downloaded attachments (images, files)
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `LINEAR_API_KEY` | **Required.** Your Linear API key |
| `TOON_DIR` | Config directory (default: `.ttt`) |

## Claude Code Plugin

Install the plugin for Claude Code integration:

```
/plugin marketplace add wayne930242/team-toon-tack
/plugin install team-toon-tack@wayne930242
```

### Available Commands

| Command | Description |
|---------|-------------|
| `/ttt:sync` | Sync Linear issues to local cycle data |
| `/ttt:work-on` | Start working on a task |
| `/ttt:done` | Mark current task as completed |
| `/ttt:status` | Show or modify task status |
| `/ttt:show` | Show issue details or search issues |

### Auto-Activated Skill

The plugin includes a `linear-task-manager` skill that automatically activates when working with Linear tasks, providing workflow guidance and best practices.

## License

MIT
