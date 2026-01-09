---
name: ttt-sync
description: Sync Linear issues to local cycle data
arguments:
  - name: issue-id
    description: Optional specific issue ID to sync (e.g., MP-624)
    required: false
  - name: update
    description: Push local status changes to Linear (add --update flag)
    required: false
---

# TTT Sync Command

Sync issues from Linear to local `.ttt/cycle.toon` file.

## Usage

Run the sync command based on arguments provided:

### Default Sync (all matching issues)
```bash
ttt sync
```

### Sync Specific Issue
If `issue-id` is provided:
```bash
ttt sync {{ issue-id }}
```

### Push Local Changes
If `update` is "true" or "--update":
```bash
ttt sync --update
```

## What This Does

1. Fetches active cycle from Linear
2. Downloads all issues matching configured filters (team, status, labels)
3. Preserves local status for existing tasks
4. Downloads Linear images to `.ttt/output/`
5. Updates `cycle.toon` with fresh data

## Output

After running, report:
- Number of tasks synced
- Current cycle name
- Any status updates pushed to Linear (if --update used)
