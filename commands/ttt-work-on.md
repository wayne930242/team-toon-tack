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

## Workflow — Plan → Test → Code → Review

Follow this loop for every task.
Skipping phases is not "pragmatic", it is debt.

### 1. Branch

```bash
git checkout -b <suggested-branch-name>
```

### 2. Plan

Scope decides depth.

- Unclear requirements or 3+ files touched → invoke `superpowers:brainstorming`, then `superpowers:writing-plans`.
- Clear and small (≤2 files, obvious change) → state a 2–3 bullet plan inline before coding.

Never go straight to code.
Planning collapses ambiguity before implementation.

### 3. Test First (TDD)

Invoke `superpowers:test-driven-development`.

Red → Green → Refactor per behavior:

1. Write one failing test naming the behavior.
2. Run test — verify it fails for the expected reason.
3. Write minimal code to pass.
4. Run test — verify pass, other tests still green.
5. Refactor if needed, keep green.

No production code without a failing test first.

### 4. Review (before `/ttt:done`)

Invoke `superpowers:verification-before-completion`.

Run and confirm output:

- Full test suite passes.
- `npm run lint` / `npm run type` clean (or project-specific commands).
- Only requested scope changed — no drive-by edits.
- No debug logs, stubs, TODOs.

Evidence before assertions.
Do not claim complete without running the commands.

### 5. Complete

```text
/ttt:done -m "summary"
```

A task is NOT complete until `/ttt:done` runs.
This is MANDATORY.

## Project-Specific Skill

Check `.claude/skills/work-on/` or `.claude/skills/start-work/` for project-specific lint / type / test commands and conventions.
If missing, suggest `/ttt:write-work-on-skill` — it scaffolds a skill following this same 4-phase structure.

## Error Handling

| Error | Solution |
|-------|----------|
| `No cycle data found` | Run `ttt sync` first |
| `No eligible tasks` | All tasks assigned or in-review; run `ttt sync` to refresh |
| `Issue not found` | Run `ttt sync <id>` to fetch it |
