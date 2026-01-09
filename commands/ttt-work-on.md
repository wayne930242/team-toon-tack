---
name: ttt-work-on
description: Start working on a Linear task
arguments:
  - name: issue-id
    description: Issue ID (e.g., MP-624), 'next' for auto-select, or omit for interactive
    required: false
---

# TTT Work-On Command

Start working on a task from the current cycle.

## Usage

### Interactive Selection
```bash
ttt work-on
```

### Specific Issue
If `issue-id` is provided (e.g., MP-624):
```bash
ttt work-on {{ issue-id }}
```

### Auto-Select Highest Priority
If `issue-id` is "next":
```bash
ttt work-on next
```

## What This Does

1. Marks the task as `in-progress` locally
2. Updates Linear status to "In Progress" (if status_source is remote)
3. Displays full task details including:
   - Title and description
   - Priority and labels
   - Attachments and comments
   - Branch name for checkout

## After Running

1. Read the task description and requirements
2. Check out the suggested branch: `git checkout -b <branch-name>`
3. Run type-check and lint before starting: `bun type-check && bun lint`
4. Begin implementation
