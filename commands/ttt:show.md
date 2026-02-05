---
name: ttt:show
description: Show issue details or search issues from local cycle data
arguments:
  - name: issue-id
    description: Issue ID to show (e.g., MP-624)
    required: false
  - name: label
    description: Filter by label
    required: false
  - name: status
    description: "Filter by status (e.g., 'In Progress', 'Todo')"
    required: false
  - name: user
    description: "Filter by assignee (email, 'me', or 'unassigned')"
    required: false
  - name: priority
    description: "Filter by priority (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low)"
    required: false
  - name: remote
    description: Fetch from Linear API instead of local data
    required: false
  - name: export
    description: Output as markdown format
    required: false
---

<law>
YOU MUST execute the `ttt show` command using the Bash tool.
DO NOT read cycle.toon directly — the CLI handles formatting and filtering.
DO NOT simulate or fabricate issue data.
</law>

# /ttt:show — Show Issues

## Execution

Build the command from arguments and run it:

```bash
ttt show {{ issue-id }} \
  {{ "--label " + label if label }} \
  {{ "--status \"" + status + "\"" if status }} \
  {{ "--user " + user if user }} \
  {{ "--priority " + priority if priority }} \
  {{ "--remote" if remote }} \
  {{ "--export" if export }}
```

### Common Examples

```bash
ttt show                                    # List all local issues
ttt show MP-624                             # Show specific issue
ttt show MP-624 --remote                    # Fetch fresh from Linear
ttt show MP-624 --export                    # Export as markdown
ttt show --label frontend                   # Filter by label
ttt show --status "In Progress" --user me   # My in-progress issues
ttt show --priority 1                       # All urgent issues
ttt show --export                           # Export all as markdown
```

## Full CLI Reference

```
Usage: ttt show [issue-id] [options]

Arguments:
  issue-id              Optional. Show specific issue (e.g., MP-624)

Options:
  --remote              Fetch from Linear instead of local data
  --export              Output as markdown format
  --label <label>       Filter by label
  --status <status>     Filter by status
  --user <email>        Filter by assignee ("me", "unassigned", or email)
  --priority <n>        Filter by priority (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low)
```

## After Execution

Present the output to the user. If `--export` was used, the output is markdown-formatted and can be used as context.

## Error Handling

| Error | Solution |
|-------|----------|
| `No cycle data found` | Run `ttt sync` first |
| `Issue not found` | Try `ttt show <id> --remote` or `ttt sync <id>` |
| `LINEAR_API_KEY not set` | Required for `--remote`; ask user to set it |
