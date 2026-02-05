---
name: ttt:status
description: Show or modify task status
arguments:
  - name: issue-id
    description: Issue ID to check/modify (omit for current in-progress task)
    required: false
  - name: set
    description: "New status: +1, -1, +2, -2, pending, in-progress, completed, blocked, todo, done"
    required: false
---

<law>
YOU MUST execute the `ttt status` command using the Bash tool.
DO NOT manually edit cycle.toon or manipulate status by other means.
The CLI handles both local and remote status synchronization.
</law>

# /ttt:status — Show or Modify Task Status

## Execution

```bash
ttt status {{ issue-id }} {{ "--set " + set if set }}
```

### Common Examples

```bash
ttt status                          # Show current in-progress task
ttt status MP-624                   # Show specific issue status
ttt status MP-624 --set +1          # Move to next status
ttt status MP-624 --set blocked     # Mark as blocked
ttt status --set pending            # Reset current task
```

## Full CLI Reference

```
Usage: ttt status [issue-id] [--set <status>]

Arguments:
  issue-id              Optional. Issue ID (omit for current in-progress task)

Options:
  -s, --set <status>    Set status. Values:
                        +1           Next status (pending → in-progress → completed)
                        -1           Previous status
                        +2           Skip two forward
                        -2           Skip two backward
                        pending      Set to pending
                        in-progress  Set to in-progress
                        completed    Set to completed
                        blocked      Set to blocked
                        todo         Set Linear to Todo
                        done         Set Linear to Done
```

## Status Flow

```
pending → in-progress → completed
               ↓
            blocked
```

## After Execution

Report:
- Task ID and title
- Local status vs Linear status
- Priority and labels

## Error Handling

| Error | Solution |
|-------|----------|
| `No in-progress task` | Specify issue-id or run `ttt work-on` first |
| `Issue not found` | Run `ttt sync` to refresh local data |
