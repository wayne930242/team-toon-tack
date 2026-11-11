---
name: ttt:order
description: Work orders - carry a train batch of tickets from claim to Done
arguments:
  - name: command
    description: "open, list, show, set, review, train, seal, drop, export, import, reclaim, or close"
    required: true
  - name: args
    description: "Order id (<project>/<code>), ticket ids, and options for the command"
    required: false
---

<law>
YOU MUST execute `ttt order` (and `ttt claim --order`) using the Bash tool.
DO NOT edit files under `.ttt/orders/` by hand, and DO NOT commit them.
ONE side writes an order at a time: the coordinator records for its workers; after `export --handoff` only the receiver writes.
</law>

# /ttt:order — Work Orders

A work order is one TOON file per train batch (`.ttt/orders/<project>/<code>.toon`).
It holds the batch's tickets with each one's branch, MR, head, review verdict, and test runs, and it closes every ticket with one command after the train merged.

## Execution

```bash
ttt order {{ command }} {{ args }}
```

## Flow

### Coordinator: claim, record, review, seal, hand off

```bash
ttt claim MP-624 MP-625 --order auto --project app   # Claim into the project's open order
ttt order list                                       # Find the order id, e.g. app/2026-11-11-a

# A worker reports its MR: the coordinator records it (workers never write the order)
ttt order set app/2026-11-11-a MP-624 --branch feat/mp-624 --mr '!812' --head 1a2b3c4
ttt order set app/2026-11-11-a MP-624 --review "P0/P1=0 @1a2b3c4" \
    --tests "bun test scripts/order = pass"

ttt order review app/2026-11-11-a MP-624 MP-625      # Move to the testing status
ttt order drop app/2026-11-11-a MP-626 --reason "not ready for this train"

ttt order train app/2026-11-11-a --branch agent-train/2026-11-11-a --mr '!900'
ttt order seal app/2026-11-11-a --gated-head 5d6e7f8 # No more tickets
ttt order export app/2026-11-11-a --handoff          # Paste the block into the train MR or slip
```

After the seal, `ttt claim <id> --order auto` opens the next order.
After `--handoff` the local copy is read-only.

### Integrator: import, merge, close

```bash
glab mr view 900 | ttt order import -                # Or: ttt order import slip.md
ttt order show app/2026-11-11-a
# ... merge the train ...
ttt order close app/2026-11-11-a --merged 9a8b7c6 --version v1.2.0 --dry-run
ttt order close app/2026-11-11-a --merged 9a8b7c6 --version v1.2.0
```

`close` completes every in-review ticket through the configured completion mode (parent issues included) and comments MR, merge commit, version, and order id on each.
Dropped tickets are untouched.
A ticket must reach the done status: under `strict_review` (or `upstream_strict` without a parent) it stops at testing, so close fails it and the order stays merged.
When a ticket fails, fix the cause and rerun the same command: done tickets are skipped and no comment is posted twice.

### A returned train

The integrator returns the order with `ttt order export <id> --handoff`, and the coordinator runs `ttt order import <file>`.
When nothing came back, the coordinator runs `ttt order reclaim <id>`.
A reworked ticket stays in its order: record the new head and test runs with `set`, then `seal` again with the new gated head and hand off again.

## Full CLI Reference

```
Usage: ttt order <command> [options]

Commands:
  open [<project>/<code>] [--project <p>] [--reviewer <name>]
        Open an order. Without an id: <project>/<YYYY-MM-DD>-<next letter>.
        A project holds one open order at a time.
  list [--project <p>] [--all]
        List orders (closed ones only with --all).
  show <id> [--toon]
        Show an order; --toon prints the stored TOON.
  set <id> <ticket> [--branch <b>] [--mr <mr>] [--head <sha>]
        [--review <verdict>] [--tests "<cmd> [@ <sha>] [= <result>]"]...
        Record a ticket's branch, MR, head, review verdict, and test runs.
        Each --tests appends one run; the sha defaults to the ticket's
        head, the result to "pass".
  review <id> <ticket>... [--status <name>]
        Move tickets to the testing status (assignee unchanged) and mark
        them in-review. An open order adopts a ticket it does not hold yet,
        unless another order of the project holds it. Done or Canceled
        tickets are left where they are.
  train <id> [--branch <b>] [--mr <mr>]
        Record the train branch and its merge request.
  seal <id> --gated-head <sha>
        Fix the batch: no more tickets. Every ticket must be in review or
        dropped. Sealing again records a new gated head.
  drop <id> <ticket> --reason <text>
        Leave a ticket out of the batch; its remote status is not touched.
  export <id> [--handoff]
        Print the order as a fenced block for an MR description or a slip.
        --handoff makes this copy read-only: the receiver writes from now on.
  import <file|-> [--id <id>] [--force]
        Read the block out of any text and become the order's writer.
  reclaim <id>
        Take a handed-off order back when it was returned without an export.
  close <id> --merged <sha> [--version <v>] [--dry-run]
        After the train merged: complete every in-review ticket through the
        configured completion mode, and comment MR, merge commit, version,
        and order id on each. Dropped tickets are untouched. Safe to rerun.
```

The default project is the directory that holds `.ttt`.
The writer's name is `TTT_ACTOR`, else `<current_user>@<hostname>`.

## Error Handling

| Error | Solution |
|-------|----------|
| `was handed off ... read-only` | Import the returned copy, or `ttt order reclaim <id>` |
| `takes no more tickets` | The order is sealed: claim with `--order auto` to use the next one |
| `Cannot seal ...: MP-x still in progress` | `ttt order review <id> MP-x` or `ttt order drop <id> MP-x --reason ...` |
| `is not sealed` on close | `ttt order seal <id> --gated-head <sha>` first |
| `is Canceled at the source` on close | `ttt order drop <id> MP-x --reason canceled`, then rerun close |
| `no longer in review` on close | The ticket moved since the seal: `ttt order drop` it, or put it back in review |
| `is In Review, not Done` on close | The completion mode stops at testing; move it to Done or change `completion_mode`, then rerun |
| `already in order ...` on review | A ticket rides one order per project; drop it there first |
| `already exists here as a writable copy` on import | Check which copy is current; replace the local one with `--force` |
| `No work order block found` | Pass text that contains the block printed by `ttt order export` |
