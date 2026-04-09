---
name: ttt:cancel
description: Cancel a Linear/Trello issue (moves to Cancelled status)
arguments:
  - name: issue-id
    description: Issue ID to cancel (required)
    required: true
  - name: flags
    description: "Optional: --yes to skip confirmation"
    required: false
---

<law>
YOU MUST execute the `ttt cancel` command using the Bash tool.
DO NOT call Linear/Trello APIs directly — the CLI handles adapter selection and cache removal.
Always confirm with the user before cancelling unless they explicitly pass `--yes`.
</law>

# /ttt:cancel — Cancel Issue

## Execution

```bash
ttt cancel {{ issue-id }} {{ flags }}
```

### Common Examples

```bash
ttt cancel MP-123           # Cancel with interactive confirmation
ttt cancel MP-123 --yes     # Cancel without confirmation prompt
```

## Full CLI Reference

```
Usage: ttt cancel <issue-id> [--yes]

Arguments:
  issue-id    Issue ID to cancel (e.g., MP-123)

Options:
  -y, --yes   Skip confirmation prompt
```

## Behavior

- Finds the team's "Cancelled" workflow state automatically
- Removes the task from local `cycle.toon` if it was present
- Remote-only issues (not in local cache) are cancelled but no local change is made

## After Execution

Report:
- Issue ID and cancellation confirmation
- Whether it was removed from local cycle data

## Error Handling

| Error | Solution |
|-------|----------|
| `Issue ID is required` | Provide the issue ID as argument |
| `Issue not found` | Verify the ID exists in Linear/Trello |
| `No 'cancelled' workflow state found` | Team has no Cancelled state configured in Linear |
