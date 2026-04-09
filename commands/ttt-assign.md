---
name: ttt:assign
description: Reassign a Linear/Trello issue to a different user
arguments:
  - name: issue-id
    description: Issue ID to reassign (omit for current in-progress task)
    required: false
  - name: assignee
    description: User key from config (omit for interactive select)
    required: false
---

<law>
YOU MUST execute the `ttt assign` command using the Bash tool.
DO NOT call Linear/Trello APIs directly — the CLI handles adapter selection and local cache updates.
</law>

# /ttt:assign — Reassign Issue

## Execution

```bash
ttt assign {{ issue-id }} -a {{ assignee }}
```

### Common Examples

```bash
ttt assign MP-123 -a john     # Assign MP-123 to john
ttt assign -a jane            # Assign current in-progress task to jane
ttt assign MP-123             # Interactive assignee selection
```

## Full CLI Reference

```
Usage: ttt assign [issue-id] [-a <user-key>]

Arguments:
  issue-id                Optional. Issue ID (omit for current task)

Options:
  -a, --assignee <key>    User key from config. If omitted, interactive select.
```

## After Execution

Report:
- Issue ID and new assignee display name
- Confirmation that local cache was updated

## Error Handling

| Error | Solution |
|-------|----------|
| `No in-progress task found` | Specify issue ID explicitly |
| `User "<key>" not found` | Check key against `config.users` |
| `Issue not found` | Verify issue exists in Linear/Trello |
| `No source ID` | Issue has no remote ID — run `ttt sync` first |
