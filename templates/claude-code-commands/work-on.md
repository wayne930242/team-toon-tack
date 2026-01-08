---
name: work-on
description: Select and start working on a Linear issue
arguments:
  - name: issue-id
    description: "Issue ID (e.g., MP-624) or 'next' for auto-select"
    required: false
---

# Start Working on Issue

Select a task and update status to "In Progress" on both local and Linear.

## Process

### 1. Run Command

```bash
ttt work-on -d .ttt $ARGUMENTS
```

### 2. Review Issue Details

Script displays title, description, priority, labels, and attachments.

### 3. Implement

1. Read the issue description carefully
2. Explore related code
3. Implement the fix/feature
4. Commit with conventional format

### 4. Verify

Run project-required verification before completing:

```bash
# Run verification procedure defined in project
# (e.g., type-check, lint, test, build)
```

### 5. Complete

Use `/done-job` to mark task as completed

## Example Usage

```
/work-on
/work-on MP-624
/work-on next
```
