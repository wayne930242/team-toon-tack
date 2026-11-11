---
description: Integrator's side of a work order (import at receipt, return or rework tickets, close the batch after the merge).
---

# Work orders: integrator

You receive a gated train, merge it, and close its tickets.
The train's merge request description carries its work order as a fenced `toon ttt-order` block.
Importing it makes you the order's one writer; the coordinator's copy is read-only from the handoff on.

## At receipt

1. Import from the checkout that holds `.ttt`: `glab mr view <n> -R <repo> | ttt order import -` (GitHub: `gh pr view <n> -R <repo> --json body -q .body | ttt order import -`; a saved file: `ttt order import <file>`).
2. `ttt order show <order>`: check the ticket list against what you were told rides the train, the gated head against the train's head, and each ticket's review and test runs. A review marked `stale` was given on an older head. While the gated head is the head you merge, reuse the recorded runs instead of running them again.

## While integrating

| Situation | Do |
|-----------|----|
| A ticket leaves the train and goes back to its coordinator (it breaks the gate, or waits for a paired change) | `ttt order return <order> <ticket>... --reason "<why>"`, and send the printed notice block to the coordinator |
| You fix a ticket inside this train | `ttt order rework <order> <ticket> --reason "<why>"`; then `ttt order set` the new head, review, and tests, `ttt order review <order> <ticket>`, and `ttt order seal <order> --gated-head <new sha>` |
| A ticket is void (canceled, duplicate) | `ttt order drop <order> <ticket> --reason "<why>"` |
| The whole train goes back | `ttt order export <order> --handoff` into the return message; the coordinator imports it |

`return` moves the ticket to in-progress at the source with the assignee unchanged, and the notice carries the ticket's whole record, so the coordinator's `carry` takes branch, MR, head, review, and test runs into its next order.
For a ticket that will ride a later train use `return`, not `drop`: the coordinator's copy is read-only and learns of a drop only when the order itself comes back.
Repeating `return` prints the notice again and changes nothing.

`rework` on a sealed order reopens it and clears the gated head, so `close` refuses until you seal again on the head you gated.

## After the merge

1. `ttt order close <order> --merged <merge sha> --version <version> --dry-run`, and read what it would do.
2. The same command without `--dry-run`. Each in-review ticket goes through the configured completion mode to the done status and gets one comment with its MR, the merge commit, the version, and the order id. Dropped and returned tickets are left alone and do not keep the order open.
3. Exit code 1 means a ticket failed and the order stays `merged`: fix the cause named on that ticket's line and rerun the same command. Done tickets are skipped, and no comment is posted twice.

`close` is what records the merge on each ticket, so a train's tickets are never closed one by one with `ttt done`.

| `close` says | Do |
|--------------|----|
| `is not sealed` | A `rework` reopened the order: seal again with the head you gated |
| `is still in-progress in the order` | `ttt order review` it when it is in the merge; else `return` or `drop` it |
| `is Canceled at the source` | `ttt order drop <order> <ticket> --reason canceled`, then rerun |
| `no longer in review` | It moved since the seal: `ttt order review` it when it is in the merge, else `return` it |
| `is In Review, not Done` | The completion mode stops at testing: move it to Done or change `completion_mode`, then rerun |
