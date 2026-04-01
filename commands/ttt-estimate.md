---
name: ttt:estimate
description: Save a local human-effort estimate for a task
arguments:
  - name: issue-id
    description: Issue ID to estimate (e.g., MP-624)
    required: false
  - name: hours
    description: Estimated human engineer hours (supports decimals)
    required: false
  - name: note
    description: Short estimate note or assumption summary
    required: false
  - name: clear
    description: Remove the existing estimate from the task
    required: false
---

<law>
YOU MUST execute the `ttt estimate` command using the Bash tool.
DO NOT manually edit cycle.toon — the CLI handles persistence safely.
DO NOT put agent runtime here; store human engineer implementation effort only.
</law>

# /ttt:estimate — Save Task Estimate

## Execution

```bash
ttt estimate {{ issue-id }} {{ hours }} {{ "--note \"" + note + "\"" if note }} {{ "--clear" if clear }}
```

### Common Examples

```bash
ttt estimate MP-624 6
ttt estimate 2.5
ttt estimate MP-624 16 --note "backend contract pending"
ttt estimate MP-624 --clear
```

## Full CLI Reference

```
Usage: ttt estimate [issue-id] [hours] [options]

Arguments:
  issue-id              Optional. Issue ID (e.g., MP-624)
  hours                 Estimated human engineer hours (supports decimals)

Options:
  -n, --note <text>     Short estimate note or assumption summary
  --clear               Remove existing estimate from the task
```

## What It Does

- Stores the estimate in local `.ttt/cycle.toon`
- Preserves that estimate across future `ttt sync` runs
- Lets `ttt show` and `ttt status` display the saved estimate

## Error Handling

| Error | Solution |
|-------|----------|
| `No cycle data found` | Run `ttt sync` first |
| `No in-progress task found` | Specify `issue-id` explicitly |
| `Estimated hours must be a positive number` | Pass a number like `2`, `4.5`, or `16` |
