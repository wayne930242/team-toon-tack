---
name: ttt:edit
description: Edit fields (title, description, priority, labels) of a Linear/Trello issue
arguments:
  - name: issue-id
    description: Issue ID to edit (omit for current in-progress task)
    required: false
  - name: flags
    description: "Field flags: -t <title>, -d <desc>, -p <0-4>, -l <labels>"
    required: false
---

<law>
YOU MUST execute the `ttt edit` command using the Bash tool.
DO NOT call Linear/Trello APIs directly — the CLI handles adapter selection and cache refresh.
After a successful edit, the CLI automatically refreshes the local cycle cache from remote.
</law>

# /ttt:edit — Edit Issue Fields

## Execution

```bash
ttt edit {{ issue-id }} {{ flags }}
```

If no flags are provided, interactive mode prompts you to choose which fields to change.

### Common Examples

```bash
ttt edit MP-123 -t "New title"            # Update title only
ttt edit MP-123 -p 2                      # Set priority to high
ttt edit MP-123 -l frontend,urgent        # Replace labels (comma-separated)
ttt edit -t "Updated" -p 3                # Edit current task
ttt edit MP-123                           # Interactive field selection
```

## Full CLI Reference

```
Usage: ttt edit [issue-id] [options]

Arguments:
  issue-id                  Optional. Issue ID (omit for current task)

Options:
  -t, --title <text>        New title
  -d, --description <text>  New description (empty string clears it)
  -p, --priority <0-4>      New priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)
  -l, --label <names>       Set labels (comma-separated, replaces existing)
  --no-interactive          Skip interactive prompts
```

## After Execution

Report:
- Issue ID and which fields were updated
- Confirmation that local cache was refreshed from remote

## Error Handling

| Error | Solution |
|-------|----------|
| `Priority must be 0-4` | Use valid priority value |
| `No in-progress task` | Specify issue ID |
| `Issue not found` | Verify the ID exists in Linear/Trello |
| `Warning: label "<name>" not found` | Label missing from config — will be skipped |
| `Warning: remote update succeeded but failed to refresh local cache` | Run `ttt sync` to reconcile |
