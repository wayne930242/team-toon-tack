---
name: ttt-status
description: Show or modify task status
arguments:
  - name: issue-id
    description: Issue ID to check/modify (omit for current in-progress task)
    required: false
  - name: set
    description: New status to set (+1, -1, pending, in-progress, completed, blocked, done)
    required: false
---

# TTT Status Command

Show or modify the status of a task.

## Usage

### Show Current In-Progress Task
```bash
ttt status
```

### Show Specific Issue
If `issue-id` is provided:
```bash
ttt status {{ issue-id }}
```

### Set Status
If `set` is provided:
```bash
ttt status {{ issue-id }} --set {{ set }}
```

## Status Values

| Value | Description |
|-------|-------------|
| `+1` | Move to next status (pending → in-progress → completed) |
| `-1` | Move to previous status |
| `+2` | Skip two statuses forward |
| `-2` | Skip two statuses backward |
| `pending` | Set to pending |
| `in-progress` | Set to in-progress |
| `completed` | Set to completed |
| `blocked` | Set to blocked (waiting on dependency) |
| `todo` | Set Linear to Todo status |
| `done` | Set Linear to Done status |

## Examples

```bash
ttt status MP-624 --set +1       # Move to next status
ttt status MP-624 --set blocked  # Mark as blocked
ttt status --set pending         # Reset current task
```

## Output

Displays:
- Task ID and title
- Local status vs Linear status
- Priority and labels
- Assignee information
