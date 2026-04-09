---
name: ttt:create
description: Create a new Linear/Trello issue and add to local cycle data
arguments:
  - name: title
    description: Issue title (omit to prompt interactively)
    required: false
  - name: flags
    description: "Additional flags: -d <desc>, -a <assignee>, -p <0-4>, -l <labels>, -s <status>, --parent <id>"
    required: false
---

<law>
YOU MUST execute the `ttt create` command using the Bash tool.
DO NOT call Linear/Trello APIs directly — the CLI handles adapter selection and local cache updates.
DO NOT manually edit `.ttt/` files.
</law>

# /ttt:create — Create New Issue

## Execution

```bash
ttt create -t "{{ title }}" {{ flags }}
```

If no title is provided, run `ttt create` alone for interactive mode.

### Common Examples

```bash
ttt create                                   # Interactive mode
ttt create -t "Fix login bug" -p 2           # Quick create, high priority
ttt create -t "Subtask" --parent MP-100      # Create as child issue
ttt create -t "New" -a john -l frontend,bug  # With assignee and labels
```

## Full CLI Reference

```
Usage: ttt create [options]

Options:
  -t, --title <text>       Issue title (required unless interactive)
  -d, --description <text> Description
  -a, --assignee <key>     Assignee user key from config
  -p, --priority <0-4>     Priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)
  -l, --label <names>      Label names (comma-separated)
  -s, --status <name>      Initial status name
  --parent <id>            Parent issue identifier (e.g., MP-100)
  --no-interactive         Skip interactive prompts
```

## After Execution

Report:
- Created issue ID and title
- URL if available
- Confirmation that local cycle data was updated

## Error Handling

| Error | Solution |
|-------|----------|
| `Title is required when --no-interactive is set` | Provide `-t "title"` |
| `Priority must be 0-4` | Use valid priority value |
| `User "<key>" not found` | Check assignee key against `config.users` |
| `Parent issue "<id>" not found` | Verify parent exists in Linear/Trello |
| `Warning: label "<name>" not found` | Label not in config — will be skipped |
