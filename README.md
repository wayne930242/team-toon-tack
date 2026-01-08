# team-toon-tack (ttt)

[繁體中文](./README.zh-TW.md) | English

Optimized Linear workflow for Claude Code — saves significant tokens compared to MCP.

## Features

- **Token Efficient** — Local cycle cache eliminates repeated API calls, saving significant tokens vs Linear MCP
- **Smart Task Selection** — Auto-pick highest priority unassigned work with `/work-on next`
- **Multi-team Support** — Sync and filter issues across multiple teams
- **Flexible Sync Modes** — Choose between remote (immediate Linear sync) or local (offline-first, sync later with `--update`)
- **QA/PM Team Support** — Auto-update parent issues in QA/PM team to "Testing" when completing dev tasks
- **Attachment Download** — Auto-download Linear images and files to local `.ttt/output/` for AI vision analysis
- **Blocked Status** — Set tasks as blocked when waiting on external dependencies
- **Auto Command Setup** — `ttt init` can install Claude Code commands with custom prefix
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
- **Status source**: `remote` (update Linear immediately) or `local` (work offline, sync with `ttt sync --update`)
- **QA/PM team**: For cross-team parent issue updates (parent must be set in Linear)
- **Claude Code commands**: Auto-install with optional prefix (e.g., `/ttt:work-on`)

### 2. Daily Workflow

In Claude Code:

```
/sync              # Fetch all Linear issues for current cycle
/work-on next      # Pick highest priority task & start working
/done-job          # Complete task with AI-generated summary
```

That's it.

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

## License

MIT
