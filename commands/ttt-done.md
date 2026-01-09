---
name: ttt-done
description: Mark current task as completed
arguments:
  - name: issue-id
    description: Optional issue ID if multiple tasks in progress
    required: false
  - name: message
    description: Completion message (use -m flag)
    required: false
---

# TTT Done Command

Mark the current in-progress task as completed.

## Usage

### Auto-Select (single in-progress task)
```bash
ttt done
```

### Specific Issue
If `issue-id` is provided:
```bash
ttt done {{ issue-id }}
```

### With Completion Message
If `message` is provided:
```bash
ttt done -m "{{ message }}"
```

### Combined
```bash
ttt done {{ issue-id }} -m "{{ message }}"
```

## What This Does

Based on configured completion mode:

| Mode | Behavior |
|------|----------|
| `simple` | Task → Done, Parent → Done |
| `strict_review` | Task → Testing, Parent → QA Testing |
| `upstream_strict` | Task → Done, Parent → Testing |
| `upstream_not_strict` | Task → Done, Parent → Testing (no fallback) |

Also:
1. Gets latest git commit info
2. Adds completion comment to Linear with commit details
3. Syncs task back from Linear to update local status

## Before Running

Ensure you have:
1. Committed your changes with a meaningful message
2. Run tests and lint checks
3. Pushed to remote branch (if applicable)
