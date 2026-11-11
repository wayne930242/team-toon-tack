---
name: ttt:order
description: Work orders - carry a train batch of tickets from claim to Done
arguments:
  - name: command
    description: "open, list, show, set, review, train, seal, drop, rework, return, carry, export, import, reclaim, or close"
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
Dropped and returned tickets are untouched.
A ticket must reach the done status: under `strict_review` (or `upstream_strict` without a parent) it stops at testing, so close fails it and the order stays merged.
When a ticket fails, fix the cause and rerun the same command: done tickets are skipped and no comment is posted twice.

### A returned train

The integrator returns the order with `ttt order export <id> --handoff`, and the coordinator runs `ttt order import <file>`.
When nothing came back, the coordinator runs `ttt order reclaim <id>`.
A ticket that needs a fix stays in its order: `ttt order rework <id> <ticket> --reason ...` sends it back to in-progress (a sealed order reopens and its gated head is cleared), then record the new head, review, and test runs with `set`, `review` it, `seal` with the new gated head, and hand off again.

### A ticket pulled out of the train

```bash
# Integrator: hand it back; the notice block goes to the coordinator
ttt order return app/2026-11-11-a MP-625 --reason "waits for MP-630" > notice.md

# Coordinator: into the next order with branch, MR, head, review, and test runs
ttt order carry MP-625 --to auto --project app --text notice.md
```

`return` marks the ticket returned, moves it to in-progress at the source (assignee unchanged), and `close` skips it.
`carry` records `carried_from`; when the head moves later without a new `--review`, `show` marks the carried review stale.
`ttt claim --order auto` on such a ticket would start an empty record instead.
The per-side rules ship with the CLI: `ttt skill managing-linear-tasks orders-coordinator` and `ttt skill managing-linear-tasks orders-integrator`.

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
        head, the result to "pass". A review is bound to the head it was
        recorded on: when --head moves without a new --review, show marks
        the review stale (reviewed <old>, head now <new>).
  review <id> <ticket>... [--status <name>]
        Move tickets to the testing status (assignee unchanged) and mark
        them in-review. An open order adopts a ticket it does not hold yet,
        unless another order of the project holds it. Done or Canceled
        tickets are left where they are.
  train <id> [--branch <b>] [--mr <mr>]
        Record the train branch and its merge request.
  seal <id> --gated-head <sha>
        Fix the batch: no more tickets. Every ticket must be in review,
        dropped, or returned. Sealing again records a new gated head.
  drop <id> <ticket> --reason <text>
        Leave a ticket out of the batch; its remote status is not touched.
  rework <id> <ticket> --reason <text>
        Send an in-review ticket back to work inside its order: in-progress
        here and at the source (assignee unchanged). A sealed order opens
        again and its gated head is cleared, so it must be sealed anew.
  return <id> <ticket>... --reason <text>
        Writer (normally the integrator): hand tickets back to their
        coordinator. Each is marked returned with who/when/why and keeps its
        record; its remote status goes back to in-progress (assignee
        unchanged). Prints a return notice block for the coordinator.
        Close skips returned tickets. Safe to repeat.
  carry <ticket>... --to <id|auto> [--project <p>] [--from <id> | --text <file|->]
        Coordinator: take tickets into another open order with their branch,
        MR, head, review, and test runs, plus a carried_from record. auto is
        the open order of --project (default: the source's project). The
        history comes from a local order (--from, else the newest order of
        the project that holds the ticket) or from a return notice or order
        block in --text. A source this machine writes marks them dropped
        ("carried to <order>"). A ticket must have left its source (returned
        or dropped) unless this machine writes the source. Remote statuses
        are not touched.
  export <id> [--handoff]
        Print the order as a fenced block for an MR description or a slip.
        --handoff makes this copy read-only: the receiver writes from now on.
  import <file|-> [--id <id>] [--force] [--returns | --order]
        Read the block out of any text and become the order's writer.
        A return notice is recorded on your copy instead, even a handed-off
        one, and does not change who writes. When the text holds both, pick
        with --returns or --order.
  reclaim <id>
        Take a handed-off order back when it was returned without an export.
  close <id> --merged <sha> [--version <v>] [--dry-run]
        After the train merged: complete every in-review ticket through the
        configured completion mode, and comment MR, merge commit, version,
        and order id on each. Dropped and returned tickets are untouched.
        Safe to rerun.
```

The default project is the directory that holds `.ttt`.
The writer's name is `TTT_ACTOR`, else `<current_user>@<hostname>`.

## Error Handling

| Error | Solution |
|-------|----------|
| `was handed off ... read-only` | Import the returned copy, or `ttt order reclaim <id>` |
| `takes no more tickets` | The order is sealed: claim with `--order auto` to use the next one |
| `Cannot seal ...: MP-x still in progress` | `ttt order review <id> MP-x` or `ttt order drop <id> MP-x --reason ...` |
| `is not sealed` on close | `ttt order seal <id> --gated-head <sha>` first; a `rework` reopens a sealed order |
| `is Canceled at the source` on close | `ttt order drop <id> MP-x --reason canceled`, then rerun close |
| `no longer in review` on close | The ticket moved since the seal: `ttt order return` or `drop` it, or put it back in review |
| `is still in-review in order ..., which was handed off` on carry | The order's writer returns the ticket first (`ttt order return`), then carry with the notice (`--text`) |
| `holds a work order block and a return notice` on import | Pass `--returns` to record the notice, or `--order` to import the order |
| `is In Review, not Done` on close | The completion mode stops at testing; move it to Done or change `completion_mode`, then rerun |
| `already in order ...` on review | A ticket rides one order per project; drop it there first |
| `already exists here as a writable copy` on import | Check which copy is current; replace the local one with `--force` |
| `No work order block found` | Pass text that contains the block printed by `ttt order export` |
