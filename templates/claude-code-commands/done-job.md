---
name: done-job
description: Mark a Linear issue as done with AI summary comment
arguments:
  - name: issue-id
    description: Linear issue ID (e.g., MP-624). Optional if only one task is in-progress
    required: false
---

# Complete Task

Mark a task as done and update Linear with commit details.

## Process

### 1. Determine Issue ID

Check `.toon/cycle.toon` for tasks with `localStatus: in-progress`.

### 2. Write Fix Summary

Prepare a concise summary (1-3 sentences) covering:
- Root cause
- How it was resolved
- Key code changes

### 3. Run Command

```bash
ttt done -d .ttt $ARGUMENTS -m "修復說明"
```

## What It Does

- Linear issue status → "Done"
- Adds comment with commit hash, message, and diff summary
- Parent issue (if exists) → "Testing"
- Local status → `completed` in `.toon/cycle.toon`

## Example Usage

```
/done-job MP-624
/done-job
```
