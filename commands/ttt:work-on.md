---
name: ttt:work-on
description: Start working on a Linear task
arguments:
  - name: issue-id
    description: Issue ID (e.g., MP-624). Defaults to 'next' (auto-select highest priority)
    required: false
    default: next
---

# TTT Work-On Command

Start working on a task from the current cycle.

## Usage

### Auto-Select Highest Priority (Default)
```bash
ttt work-on next
```

### Specific Issue
```bash
ttt work-on {{ issue-id }}
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
3. **Check for work-on skill** (see below)
4. Begin implementation

## CRITICAL: After Task Completion

**MUST execute `/ttt:done` when the task is completed.**

This is MANDATORY. After finishing implementation:

1. Commit changes: `git add . && git commit -m "..."`
2. **Execute `/ttt:done -m "completion summary"`**

Do NOT skip this step. The task is not complete until `/ttt:done` is executed.

## Work-On Skill

Check for project-specific work guidelines:

### 1. Check for Existing Work-On Skill

Look for:
- **Skills**: `work-on`, `start-work`, `begin-task` in `.claude/skills/`
- **Alternative**: Check for `validate`, `check` skills that define project guidelines

### 2. If No Work-On Skill Found

Suggest user create one:
```
No work-on skill found for this project.

A work-on skill defines best practices for starting tasks:
- Code style and conventions
- Pre-work validation checks
- Branch naming conventions
- Required setup steps

Would you like to create one? (y/n)
```

If yes, run:
```
/ttt:write-work-on-skill
```

The work-on skill should include:
- **Validation**: lint, type-check, test commands
- **Code style**: formatting, naming conventions
- **Workflow**: branch naming, commit message format
- **Setup**: required dependencies, environment checks

### 3. Use Work-On Skill

Once available:
- Follow the guidelines defined in the skill
- Run any validation checks specified
- Ensure code style compliance
