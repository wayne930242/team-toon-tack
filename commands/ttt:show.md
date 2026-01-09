---
name: ttt:show
description: Show issue details or search issues from local cycle data
arguments:
  - name: issue-id
    description: Issue ID to show (e.g., MP-624)
    required: false
  - name: label
    description: Filter by label (--label <label>)
    required: false
  - name: status
    description: Filter by status (--status <status>)
    required: false
  - name: user
    description: Filter by assignee (--user <email|me|unassigned>)
    required: false
  - name: priority
    description: Filter by priority (--priority <0-4>)
    required: false
  - name: remote
    description: Fetch from Linear instead of local data (--remote)
    required: false
  - name: export
    description: Output as markdown format (--export)
    required: false
---

# TTT Show Command

Show issue details or search issues from local cycle data.

## Usage

### Show All Issues
```bash
ttt show
```

### Show Specific Issue
```bash
ttt show {{ issue-id }}
```

### Search by Filters
```bash
ttt show --label {{ label }}
ttt show --status "{{ status }}"
ttt show --user {{ user }}
ttt show --priority {{ priority }}
```

### Fetch from Linear (Remote)
```bash
ttt show {{ issue-id }} --remote
ttt show --remote --status todo
```

## What This Does

1. By default, reads from local cycle.toon data (no API calls)
2. Supports filtering by label, status, user, priority
3. Use --remote to fetch fresh data from Linear API
4. Displays comprehensive information:
   - Title and description
   - Status (both Linear and local)
   - Priority level
   - Labels
   - Assignee
   - Branch name
   - Parent issue (if subtask)
   - Attachments with local paths
   - Comments with timestamps

## Filter Options

| Option | Description | Example |
|--------|-------------|---------|
| `--label` | Filter by label name | `--label frontend` |
| `--status` | Filter by Linear status | `--status "In Progress"` |
| `--user` | Filter by assignee | `--user me`, `--user unassigned` |
| `--priority` | Filter by priority (0-4) | `--priority 1` (Urgent) |
| `--remote` | Fetch from Linear API | `--remote` |
| `--export` | Output as markdown | `--export` |

## Priority Values

- 0: None
- 1: Urgent
- 2: High
- 3: Medium
- 4: Low

## Use Cases

- List all issues in current cycle
- Search issues by label or status
- Review issue details before starting work
- Check requirements and acceptance criteria
- View attachments and mockups
- Read comment history and discussions

## Examples

```bash
# Show all local issues
ttt show

# Show specific issue
ttt show MP-624

# My in-progress issues
ttt show --status "In Progress" --user me

# All urgent issues
ttt show --priority 1

# Frontend issues
ttt show --label frontend

# Fetch fresh data from Linear
ttt show MP-624 --remote

# Export as markdown
ttt show --export
ttt show MP-624 --export
```
