---
name: ttt:work-on
description: Start working on a Linear task
arguments:
  - name: issue-id
    description: "Issue ID (e.g., MP-624) or 'next' for auto-select. Defaults to 'next'."
    required: false
    default: next
  - name: dry-run
    description: Preview selection without changing status
    required: false
---

<law>
YOU MUST execute the `ttt work-on` command using the Bash tool.
DO NOT manually edit cycle.toon or change task status by other means.
After the task is completed, YOU MUST execute `/ttt:done -m "summary"`. This is MANDATORY.
</law>

# /ttt:work-on — Start Working on a Task

## Execution

```bash
ttt work-on {{ issue-id | default: "next" }} {{ "--dry-run" if dry-run }}
```

### Argument Resolution

| Input | Command |
|-------|---------|
| (none) | `ttt work-on next` |
| `next` | `ttt work-on next` |
| `MP-624` | `ttt work-on MP-624` |
| `--dry-run` | `ttt work-on next --dry-run` |
| `MP-624 --dry-run` | `ttt work-on MP-624 --dry-run` |

## Full CLI Reference

```
Usage: ttt work-on [issue-id] [options]

Arguments:
  issue-id    Issue ID (e.g., MP-624) or 'next' for auto-select
              If omitted, shows interactive selection

Options:
  --dry-run   Pick task without changing status (preview only)
```

## After Execution

1. Read the task description and requirements from the output
2. Check out the suggested branch: `git checkout -b <branch-name>`
3. Check for project-specific **work-on skill** in `.claude/skills/`
4. Begin implementation

## CRITICAL: Task Completion Contract

When the task is completed, you MUST execute:

```
/ttt:done -m "completion summary"
```

A task is NOT complete until `/ttt:done` is executed. Do NOT skip this step.

## Work-On Skill Integration

After starting a task, check for project-specific work guidelines:

1. Look for `work-on` or `start-work` skills in `.claude/skills/`
2. If found, follow those guidelines
3. If not found, suggest creating one with `/ttt:write-work-on-skill`

## Error Handling

| Error | Solution |
|-------|----------|
| `No cycle data found` | Run `ttt sync` first |
| `No eligible tasks` | All tasks assigned or in-review; run `ttt sync` to refresh |
| `Issue not found` | Run `ttt sync <id>` to fetch it |
