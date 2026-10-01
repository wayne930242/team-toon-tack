---
name: ttt:done
description: Mark current task as completed
arguments:
  - name: issue-id
    description: Issue ID if multiple tasks in progress (e.g., MP-624)
    required: false
  - name: message
    description: Completion message summarizing what was done
    required: false
  - name: from-remote
    description: Fetch issue from Linear (bypass local data check)
    required: false
  - name: commit
    description: Commit to record instead of HEAD (e.g., an already merged commit)
    required: false
  - name: repo
    description: Git repository to read the commit from (default - cwd)
    required: false
---

<law>
YOU MUST execute the `ttt done` command using the Bash tool.
DO NOT manually edit cycle.toon or Linear status by other means.
DO NOT skip this command — it updates both local and remote status, posts a completion comment, and syncs state.
</law>

# /ttt:done — Complete a Task

## Execution

```bash
ttt done {{ issue-id }} {{ "-m \"" + message + "\"" if message }} {{ "--from-remote" if from-remote }} {{ "--commit " + commit if commit }} {{ "--repo " + repo if repo }}
```

### Common Examples

```bash
ttt done                                # Complete current in-progress task
ttt done MP-624                         # Complete specific task
ttt done -m "Fixed null check"          # With completion message
ttt done MP-624 -m "Refactored auth"    # Specific task with message
ttt done MP-624 --from-remote           # Issue not in local data, or still Todo (no claim needed)
ttt done MP-624 --commit 1a2b3c4        # Record an earlier commit, not HEAD
```

## Full CLI Reference

```
Usage: ttt done [issue-id] [-m message] [--from-remote] [--commit <sha>] [--repo <path>]

Arguments:
  issue-id              Optional. Issue ID if multiple tasks in-progress

Options:
  -m, --message         Completion message describing what was done
  -r, --from-remote     Fetch issue from Linear (bypass local data check;
                        also completes a Todo ticket without `ttt claim`)
  --commit <sha>        Record this commit instead of HEAD
  --repo <path>         Git repository to read the commit from (default: cwd)
```

## Before Running

Ensure:
1. Code changes are committed (`git add && git commit`)
2. Code quality checks passed (lint, type-check) if applicable

## What It Does

Based on configured completion mode:

| Mode | Task Status | Parent Status |
|------|-------------|---------------|
| `simple` | → Done | → Done |
| `strict_review` | → Testing | → QA Testing |
| `upstream_strict` | → Done | → Testing (no valid parent: task goes straight to Testing) |
| `upstream_not_strict` | → Done | → Testing (no fallback) |

Additionally:
- Reads latest git commit info
- Posts completion comment to Linear with commit details
- Syncs task back from Linear to update local status

## Error Handling

| Error | Solution |
|-------|----------|
| `No in-progress task` | Specify issue-id explicitly |
| `Multiple in-progress` | Specify issue-id to disambiguate |
| `Issue not found` | Use `--from-remote` flag |
| `不在進行中狀態` (task is Todo) | `ttt claim <id>` first, or `ttt done <id> --from-remote` |
| `No commits found` | Commit your changes first |
