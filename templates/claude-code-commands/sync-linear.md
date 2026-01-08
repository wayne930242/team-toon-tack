---
name: sync-linear
description: Sync Linear Frontend issues to local TOON file
---

# Sync Linear Issues

Fetch current cycle's Frontend issues from Linear to `.toon/cycle.toon`.

## Process

### 1. Run Sync

```bash
ttt sync -d .ttt
```

### 2. Review Output

Script displays a summary of tasks in the current cycle.

## When to Use

- Before starting a new work session
- When task list is missing or outdated
- After issues are updated in Linear

## Example Usage

```
/sync-linear
```
