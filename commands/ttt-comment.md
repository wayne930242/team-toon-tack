---
name: ttt:comment
description: Add a comment to a Linear/Trello issue
arguments:
  - name: issue-id
    description: Issue ID to comment on (omit for current in-progress task)
    required: false
  - name: message
    description: Comment message text
    required: true
---

<law>
YOU MUST execute the `ttt comment` command using the Bash tool.
DO NOT call Linear/Trello APIs directly — the CLI handles adapter selection.
</law>

# /ttt:comment — Add Comment to Issue

## Execution

```bash
ttt comment {{ issue-id }} -m "{{ message }}"
```

### Common Examples

```bash
ttt comment MP-624 -m "Fixed the layout bug"    # Comment on specific issue
ttt comment -m "Still investigating"              # Comment on current task
```

## Full CLI Reference

```
Usage: ttt comment [issue-id] -m <message>

Arguments:
  issue-id              Optional. Issue ID (omit for current in-progress task)

Options:
  -m, --message <text>  Comment message (required)
```

## Remote Fallback

When the specified issue is not in local cycle data, the CLI automatically fetches it from Linear/Trello.

## After Execution

Report:
- Confirmation that comment was added
- Issue ID and source (Linear/Trello)

## Error Handling

| Error | Solution |
|-------|----------|
| `Message is required` | Add `-m "your message"` |
| `No in-progress task` | Specify issue-id or run `ttt work-on` first |
| `Issue not found` | Issue doesn't exist in remote either — check the ID |
