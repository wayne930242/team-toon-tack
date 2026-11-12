---
description: Coordinator's side of a work order (claim, record worker reports, review, seal, hand off, carry returned tickets on).
---

# Work orders: coordinator

You claim tickets, dispatch workers, and build the train.
The work order is the batch's record from claim to Done: one order per train, one writer at a time.
You write it until `export --handoff`; from then on the integrator does.
Workers never write it: they report, you record.

Order ids are `<project>/<code>`.
Use the repository's directory name as the project and pass `--project <repo dir name>` with every `auto`, because one `.ttt` can serve several repositories.
From a checkout that has no `.ttt` above it (a worktree outside the project), add `--dir <project checkout>/.ttt`.

## Per ticket

1. Claim before dispatch: `ttt claim <ticket> --order auto --project <repo dir name>`. `auto` is the project's open order; after a seal it opens the next one.
2. When the worker reports, record it: `ttt order set <order> <ticket> --branch <b> --mr <!n> --head <sha> --review "<verdict>"`, plus one `--tests "<command with filter> @ <sha> = <result>"` per run. The train and the integrator reuse recorded runs instead of running them again.
3. When its merge request is open and its review is clean: `ttt order review <order> <ticket>` moves it to the testing status and keeps the assignee.
4. A ticket that rides a train is Done when the train merges: the integrator's `ttt order close` completes the whole order then. `ttt done` on it earlier reports work that is not on the integration branch.

A review is bound to the head it was recorded on.
When the head moves afterwards, `show` marks it `stale: reviewed <old>, head now <new>`: get the new head reviewed and record the verdict with `set --review`, or the integrator receives a stale review.

## Tickets that leave the batch

| Situation | Do |
|-----------|----|
| Not ready for this train, rides the next | `ttt order drop <order> <ticket> --reason "next train"`, seal, then `ttt order carry <ticket> --to auto --project <p> --from <order>` |
| Its work failed for good | `ttt order drop <order> <ticket> --reason "<failure>"`, then hand the ticket back by your project's rule (status, assignee, comment) |
| It broke the train's gate and its worker is fixing it | `ttt order rework <order> <ticket> --reason "<gate>"`; when fixed, `set` the new head, review, and tests, then `review` it again |
| The integrator pulled it out (returned, or dropped after the order closed) and sent a notice | `ttt order carry <ticket> --to auto --project <p> --text <notice file or ->` |

`carry` keeps branch, MR, head, review, and test runs and records `carried_from`; it does not touch the ticket's status at the source.
`ttt claim --order auto` on a ticket that left an order starts an empty record, so use it only when there is no history to keep.
`carry` refuses a ticket its source's writer still holds (in progress or in review in a handed-off order): the writer returns it first.

`rework` puts the ticket in progress in the order and at the source, with the assignee unchanged.
On a sealed order it also reopens the order and clears the gated head, because the gate no longer covers the batch: gate the new head and seal again.

## Train and handoff

1. Link the train: `ttt order train <order> --branch <train branch> --mr <!n>`. A train rebuilt under a new name is recorded the same way; the order's code need not match the train's name.
2. When the train's closing gate is green, seal on the gated head: `ttt order seal <order> --gated-head <sha>`. Every ticket must be in review, dropped, or returned, so first drop the ones still in progress (first row above). Seal warns about each stale review.
3. `ttt order export <order> --handoff`, and put the printed block in the train's merge request description under `Work order`. Your copy is read-only from here.

## After the handoff

- **A return notice** (a `toon ttt-return` block from the integrator): `ttt order carry <tickets> --to auto --project <p> --text <file|->` takes the tickets on and records the notice on your copy. To record it without carrying: `ttt order import <file|->`. A text that holds both the order block and a notice needs `--returns`.
- **The whole train comes back**: `ttt order import <file|->` of the integrator's `export --handoff` block makes you the writer again; when no block came back, `ttt order reclaim <order>`. Then `rework` the tickets that need fixing, record the fixes, seal with the new gated head, and export again.

`ttt order show <order>` prints every ticket's state and history and the order's log; `ttt order --help` lists every command.
