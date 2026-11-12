---
description: Local board (source local, no account) and moving it into Linear with ttt migrate.
---

# Local board and ttt migrate

A workspace whose `config.toon` has `source: { type: local }` keeps its issues in `.ttt/local`, with no Linear or Trello account and no API key.
`ttt sync` on a local board prints "nothing to sync" and exits 0.

## Working on the board

Every command from the main page works the same way: `create`, `show`, `claim`, `status`, `assign`, `edit`, `cancel`, `comment`, `done`, `estimate`, and work orders (`ttt order`).
What differs:

- IDs are `<team key>-<n>` (`MP-1`), handed out under a lock, never reused.
- `ttt show --remote` reads the whole board, not only `cycle.toon`.
- `ttt claim next` takes your own pending tickets first. With none assigned to you, it takes unassigned tickets in a Todo status (not Backlog) and leaves them unassigned.
- Story points are the board's `estimate`: `ttt create --estimate 3`, `ttt edit MP-1 --estimate 5`. `ttt estimate MP-1 6` is still your own hours, kept in `cycle.toon`.
- Relations: `ttt edit MP-2 --blocks MP-3`, `--blocked-by`, `--related`. A parent is set with `ttt create --parent MP-1`.
- Completion is `simple`: `ttt done` moves the ticket to the done status; there is no strict review or upstream mode.

```bash
ttt init --source local --team MP --user "Alice" --labels "Bug,Feature" -y
ttt create -t "Fix login" -p 2 -l Bug --estimate 3
ttt claim next
ttt done -m "Fixed"
```

Change the board only through `ttt`.
Every write holds `.ttt/local/.lock`; an issue file edited by hand can break listing for every command.

## Moving the board into Linear

Run this only when the user asks to move the board to Linear: it creates issues in a shared workspace.

```bash
export LINEAR_API_KEY="lin_api_..."
ttt migrate --to linear --dry-run          # the plan; writes nothing
ttt migrate --to linear --team ENG         # do it
ttt sync
```

1. Read the dry-run plan and show the user what does not go over as it is:
   - users with no Linear match, or whose name several Linear users share (their issues go in unassigned; an email in `config.toon` users picks one);
   - estimates off the team's scale (left out);
   - cycles, the creator, and the started, completed, and canceled dates (Linear sets those itself);
   - relations skipped because an issue left the board;
   - work orders that will switch to the Linear IDs.
2. Run it with the same `--team`.
3. On failure the source stays local and nothing is lost: fix what the error names and rerun the same command. A rerun continues where the last one stopped, never creates an issue twice, and sends issues edited since they were created as updates.
4. "Another ttt migrate is running": wait for it. Remove `.ttt/local/migration.lock` only when no `ttt migrate` runs on this machine.
5. After success, `config.toon` names Linear, and `cycle.toon` and every order under `.ttt/orders` name the Linear IDs. Use those IDs from now on. `.ttt/local/migration-linear.toon` maps old IDs to new ones; the board stays as a record.

An order still working a ticket that is no longer on the board refuses the migration: drop that ticket first (`ttt order drop <order> <ticket> --reason ...`).

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll fix the issue file by hand, it's just TOON" | A half-written or misnamed file breaks every listing. Use `ttt edit`, `ttt status`, `ttt comment`. |
| "The order still says MP-5, I'll keep using MP-5 after the migration" | After the switch `MP-5` is looked up in Linear and may be another team's issue. Use the ID the order and `cycle.toon` now hold. |
| "Migrate failed halfway; I'll delete the mapping file and start over" | The mapping is what keeps a rerun from creating every issue twice. Rerun the same command. |
| "The lock is in the way; I'll delete it" | A second run at the same time duplicates the board in Linear. Delete it only when no migrate runs. |
