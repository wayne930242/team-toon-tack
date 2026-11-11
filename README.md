# team-toon-tack (ttt)

[繁體中文](./README.zh-TW.md) | English

Optimized task workflow for Claude Code — supports Linear and Trello, saves significant tokens compared to MCP.

## Features

- **Token Efficient** — Local cycle cache eliminates repeated API calls, saving significant tokens vs MCP
- **Multi-source Support** — Works with both Linear and Trello
- **Batch Ticket Claiming** — Claim one or many tickets at once with `ttt claim`, or auto-pick your highest priority pending tasks with `ttt claim next <n>`
- **Work Orders** — One file per train batch carries its tickets from claim to Done: `ttt claim --order`, then `ttt order close` completes the whole batch after the merge
- **Multi-team Support** — Sync and filter issues across multiple teams/boards
- **Flexible Sync Modes** — Choose between remote (immediate sync) or local (offline-first, sync later with `--update`)
- **Completion Modes** — Four modes for task completion (Linear): simple, strict review, upstream strict, upstream not strict
- **QA Team Support** — Auto-update parent issues in QA team to "Testing" when completing dev tasks (Linear)
- **Attachment Download** — Auto-download images and files to local `.ttt/output/` for AI vision analysis
- **Blocked Status** — Set tasks as blocked when waiting on external dependencies
- **Persistent Estimates** — Store local human-effort estimates that survive future `ttt sync`
- **Claude Code Plugin** — Install plugin for `/ttt:*` commands and auto-activated skills
- **Cycle History** — Local `.toon` files preserve cycle data for AI context

## Quick Start

### 1. Install & Initialize

```bash
npm install -g team-toon-tack

# For Linear
export LINEAR_API_KEY="lin_api_xxxxx"

# For Trello
export TRELLO_API_KEY="your-api-key"
export TRELLO_TOKEN="your-token"

cd your-project
ttt init
```

During init, you'll be prompted to select your task source (Linear or Trello) and configure:

**For Linear:**
- **Dev team**: Your development team (single selection)
- **Dev testing status**: Testing/review status for your dev team (optional)
- **QA team(s)**: For cross-team parent issue updates, each with its own testing status (optional)
- **Completion mode**: How task completion is handled (see below)
- **Status source**: `remote` (update Linear immediately) or `local` (work offline, sync with `ttt sync --update`)

**For Trello:**
- **Board**: The Trello board to sync
- **User**: Your Trello username
- **Status mappings**: Map Trello lists to Todo (supports multiple lists)/In Progress/Done
- **Label filter**: Optional label to filter cards

### Completion Modes (Linear only)

| Mode | Behavior |
|------|----------|
| `simple` | Mark task as Done + parent as Done. Default when no QA team configured. |
| `strict_review` | Mark task to dev testing + parent to QA testing. |
| `upstream_strict` | Mark task as Done + parent to Testing. Falls back to dev testing if no parent (the task then goes straight to testing, without a Done step). Default when QA team configured. |
| `upstream_not_strict` | Mark task as Done + parent to Testing. No fallback if no parent. |

> **Note:** Trello always uses simple completion mode as it doesn't support parent issues.

### 2. Install Claude Code Plugin (Optional)

```
/plugin marketplace add wayne930242/team-toon-tack
/plugin install team-toon-tack@ttt-marketplace
```

### Codex plugin 安裝（選擇性）

先依上方步驟安裝 `ttt` CLI 並執行 `ttt init`。Plugin 提供任務管理技能，透過 shell 呼叫 CLI。

從 GitHub 安裝：

```bash
codex plugin marketplace add wayne930242/team-toon-tack
codex plugin add team-toon-tack@ttt-marketplace
```

從本地 checkout 安裝，在此 repository 根目錄執行：

```bash
codex plugin marketplace add "$PWD"
codex plugin add team-toon-tack@ttt-marketplace
```

若已註冊同名的 GitHub marketplace，先執行 `codex plugin marketplace remove ttt-marketplace`，再加入本地路徑。
修改已安裝的同版本內容後，先執行 `codex plugin remove team-toon-tack@ttt-marketplace`，再執行上述 `codex plugin add` 重新安裝。

安裝完成後開啟新的 Codex 對話，使用 `$managing-linear-tasks`，或直接說「使用 ttt 同步並列出我的任務」。Codex 會使用 `ttt sync`、`ttt show` 等 CLI 指令。

### 3. Daily Workflow

In Claude Code (with plugin installed):

```
/ttt:sync              # Fetch all issues/cards for current cycle
/ttt:work-on next      # Claim highest priority ticket & start working
/ttt:estimate MP-123 6 # Save a local 6-hour estimate
/ttt:done              # Complete task with AI-generated summary
```

Or using CLI directly:

```bash
ttt sync
ttt claim next
ttt estimate MP-123 6
ttt done -m "Completed the task"
```

---

## CLI Reference

### `ttt init`

Initialize configuration in current directory.

```bash
ttt init                           # Interactive mode (select source)
ttt init --source=linear           # Initialize for Linear
ttt init --source=trello           # Initialize for Trello
ttt init --user alice@example.com  # Pre-select user
ttt init --label Frontend          # Set default label
ttt init --force                   # Overwrite existing config
```

### `ttt sync`

Sync current cycle issues from Linear/Trello.

Only issues assigned to `current_user` are synced. Leave `current_user` empty in
`.ttt/local.toon` for a team-wide sync.

```bash
ttt sync              # Sync Todo/In Progress issues (fast)
ttt sync --all        # Sync all issues regardless of status
ttt sync MP-123       # Sync specific issue only
ttt sync --update     # Push local status changes to remote (for local mode)
```

### `ttt claim`

Claim ticket(s): move them to in-progress locally and on the remote source.
Alias: `ttt work-on`.

```bash
ttt claim                  # Interactive multi-select
ttt claim MP-123           # Claim one ticket
ttt claim MP-123 MP-124    # Batch claim
ttt claim next             # Claim highest priority pending task
ttt claim next 3           # Claim top 3 pending tasks
ttt claim --dry-run        # Preview without changes
ttt claim MP-123 --order auto --project app   # Also record it in the project's open work order
```

Completed, in-review, and blocked tickets are reported and skipped without
stopping the rest of the batch. An ID that local data does not hold (for example
a Backlog ticket outside the cycle) is fetched from the source, stored locally,
and claimed like any other; with `--dry-run` it is shown but not stored. An ID
found neither locally nor at the source aborts before anything is claimed.
A ticket that is already closed (done or canceled) is reported and skipped. Note
that a full `ttt sync` rewrites local data from the current cycle, so a stored
ticket outside it drops out on the next sync (`ttt done <id> --from-remote`
still completes it).

`--order <id|auto>` also records the claimed tickets in a [work order](#ttt-order).
`auto` means the project's open order; when the last one was sealed, a new order `<project>/<YYYY-MM-DD>-<next letter>` is opened.
`--project <name>` names the project for `auto` (default: the directory that holds `.ttt`).
An order that cannot take the ticket (sealed, handed off, closed) refuses before anything is claimed.

### `ttt estimate`

Save a local human-effort estimate that persists in `.ttt/cycle.toon`.

```bash
ttt estimate MP-123 6                         # Save a 6-hour estimate
ttt estimate 2.5                              # Save estimate for current in-progress task
ttt estimate MP-123 16 --note "API pending"   # Save estimate with a note
ttt estimate MP-123 --clear                   # Remove saved estimate
```

### `ttt done`

Mark task as completed.

```bash
ttt done                         # Auto-select if only one in-progress
ttt done MP-123                  # Specific issue
ttt done MP-123 MP-124 -m "Merged in v1.2.0"   # Several issues, one message
ttt done -m "Fixed the bug"      # With completion message
ttt done MP-123 --from-remote    # Fetch from remote (bypasses local data check)
ttt done MP-123 --commit 1a2b3c4 # Record this commit instead of HEAD
ttt done MP-123 --commit 1a2b3c4 --repo ~/projects/app   # ...read from another repository
```

Use `--from-remote` (or `-r`) when the issue exists in remote but not in local sync data, or when the ticket is still Todo and you want to complete it without `ttt claim` (no extra In Progress transition). `ttt done` without it only accepts in-progress tasks.

Use `--commit <sha>` (and `--repo <path>` when the commit lives in another checkout) to close a ticket whose commit was merged earlier. Without it, the current HEAD is recorded.

With several IDs, `-m`, `--commit`, `--repo`, and `--from-remote` apply to every ticket.
Each ticket gets a result line, and one failing ticket does not stop the rest.
A ticket that is already done is reported and skipped, so a run can be repeated after a partial failure.
The exit code is non-zero when any ticket failed.
To close a whole train batch after its merge, use a [work order](#ttt-order) instead.

### `ttt order`

A work order is one TOON file per train batch.
It carries the batch's tickets from claim to Done, with each ticket's branch, MR, head, review verdict, and passed test runs in one place.
Use it when several tickets ride one integration branch and are closed together after its merge.

```bash
# Coordinator (the one writer while tickets are being worked on)
ttt claim MP-1 MP-2 --order auto --project app      # Claim into the project's open order
ttt order set app/2026-11-11-a MP-1 --branch feat/mp-1 --mr '!812' --head 1a2b3c4 \
    --review "P0/P1=0" --tests "bun test scripts/x = pass"
ttt order review app/2026-11-11-a MP-1 MP-2         # Move to the testing status, keep the assignee
ttt order train app/2026-11-11-a --branch agent-train/2026-11-11-a --mr '!900'
ttt order seal app/2026-11-11-a --gated-head 5d6e7f8   # No more tickets
ttt order export app/2026-11-11-a --handoff         # Paste the block into the train MR

# Integrator (the writer after the handoff)
glab mr view 900 | ttt order import -               # Reads the block out of any text
ttt order close app/2026-11-11-a --merged 9a8b7c6 --version v1.2.0 --dry-run
ttt order close app/2026-11-11-a --merged 9a8b7c6 --version v1.2.0
```

| Command | What it does |
|---------|--------------|
| `open [<project>/<code>] [--project p] [--reviewer r]` | Open an order. Without an id the code is `<YYYY-MM-DD>-<next letter>`. |
| `list [--project p] [--all]` | List orders; closed ones only with `--all`. |
| `show <id> [--toon]` | Show an order, or its stored TOON. |
| `set <id> <ticket> [--branch --mr --head --review --tests]` | Record what a worker reported. Each `--tests "<cmd> [@ <sha>] [= <result>]"` appends one run; the SHA defaults to the ticket's head and the result to `pass`. |
| `review <id> <ticket>... [--status name]` | Move tickets to the testing status (`status_transitions.testing`, else `dev_testing_status`) and mark them in-review. |
| `train <id> [--branch b] [--mr mr]` | Record the train branch and its merge request. |
| `seal <id> --gated-head <sha>` | Fix the batch on the head the gate passed on. Every ticket must be in review or dropped. |
| `drop <id> <ticket> --reason <text>` | Leave a ticket out of the batch. Its remote status is not touched. |
| `export <id> [--handoff]` | Print the order as a fenced block. `--handoff` makes the local copy read-only. |
| `import <file\|-> [--id id] [--force]` | Take the block from a file or stdin; the importer becomes the writer. |
| `reclaim <id>` | Take a handed-off order back when it was returned without an export. |
| `close <id> --merged <sha> [--version v] [--dry-run]` | Complete every in-review ticket and comment on each. |

How an order behaves:

- **Storage.** Orders live in `.ttt/orders/<project>/<code>.toon` on the writer's machine and are never committed. Writes are atomic (temp file, then rename) and serialized by a lock per project. The default project is the directory that holds `.ttt`.
- **Stages.** `open` → `sealed` → `merged` → `closed`. A project holds one open order at a time. After the seal, `ttt claim --order auto` opens the next one, and a returned ticket is reworked inside its own order: record the new head with `set`, then `seal` again.
- **One writer.** Workers report; the coordinator records. `export --handoff` passes the pen to the integrator, and write commands on the handed-off copy refuse with the way back: import the returned copy, or `reclaim`. An import never overwrites a writable local copy without `--force`, and never takes an older revision.
- **Close.** Each in-review ticket goes through the same completion handler as `ttt done`, so `completion_mode` and parent issues apply. Each gets one comment with its MR, the merge commit, the version, and the order id. Dropped tickets are untouched. A ticket canceled at the source stops the close until it is dropped. A rerun skips what is already done and does not comment twice.
- **Identity.** The writer's name in `owner` and the log is `TTT_ACTOR`, else `<current_user>@<hostname>`.

A ticket rides one order at a time: claiming it into a second order is refused until it is dropped from the first.

### `ttt status`

Show or modify task status.

```bash
ttt status              # Show current in-progress task
ttt status MP-123       # Show specific issue status
ttt status MP-123 --set +1      # Move to next status
ttt status MP-123 --set done    # Mark as done
ttt status MP-123 --set blocked # Set as blocked (waiting on dependency)
```

### `ttt show`

Show issue details or search issues from local cycle data.

```bash
ttt show                       # Show all issues in local cycle data
ttt show MP-123                # Show specific issue from local data
ttt show MP-123 --remote       # Fetch specific issue from remote
ttt show --label frontend      # Filter by label
ttt show --status "In Progress" --user me   # My in-progress issues
ttt show --priority 1          # Show urgent issues
ttt show --export              # Export as markdown
ttt show --remote --status Backlog --creator me   # Backlog tickets I created
ttt show --remote --status Backlog --user me      # Backlog tickets assigned to me
ttt show --remote --any-cycle --creator me        # My tickets in any cycle
```

Two options widen a `--remote` search beyond what `ttt sync` stores (both need
`--remote`; otherwise the command fails instead of ignoring them):

- `--creator <me|email|name>` filters by who created the issue (Linear only;
  Trello cards expose no creator, so it fails there). Without `--user`, the
  assignee scope is lifted, so tickets you created for others or left
  unassigned show up.
- `--any-cycle` searches outside the current cycle. `--status Backlog` implies
  it, because backlog tickets usually belong to no cycle. Trello has no cycles,
  so there it changes nothing.

### `ttt config`

Configure settings.

```bash
ttt config              # Show current configuration
ttt config status       # Configure status mappings
ttt config filters      # Configure label/user filters
ttt config teams        # Configure multi-team selection
```

## Configuration

### Directory Structure

```
your-project/
└── .ttt/
    ├── config.toon     # Team config (gitignore recommended)
    ├── local.toon      # Personal settings (gitignore)
    ├── cycle.toon      # Current cycle data + local estimates (auto-generated)
    ├── orders/         # Work orders: <project>/<code>.toon (never commit)
    └── output/         # Downloaded attachments (images, files)
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `LINEAR_API_KEY` | **Required for Linear.** Your Linear API key |
| `TRELLO_API_KEY` | **Required for Trello.** Your Trello API key |
| `TRELLO_TOKEN` | **Required for Trello.** Your Trello authorization token |
| `TOON_DIR` | Config directory (default: `.ttt`) |
| `TTT_ACTOR` | Writer's name in work orders (default: `<current_user>@<hostname>`) |

### Trello Setup

1. Get your API key from: https://trello.com/power-ups/admin
2. Generate a token by visiting the authorization URL shown during `ttt init`
3. Set both `TRELLO_API_KEY` and `TRELLO_TOKEN` in your environment

### Concept Mapping: Linear vs Trello

| Concept | Linear | Trello |
|---------|--------|--------|
| Container | Team | Board |
| Task | Issue | Card |
| Status | Workflow State | List |
| Tag | Label | Label |
| Sprint | Cycle | - (not supported) |
| Parent | Parent Issue | - (not supported) |

## Claude Code Plugin

Install the plugin for Claude Code integration:

```
/plugin marketplace add wayne930242/team-toon-tack
/plugin install team-toon-tack@ttt-marketplace
```

### Available Commands

| Command | Description |
|---------|-------------|
| `/ttt:sync` | Sync issues to local cycle data |
| `/ttt:work-on` | Claim ticket(s) and work on them |
| `/ttt:estimate` | Save a local human-effort estimate |
| `/ttt:done` | Mark one or more tasks as completed |
| `/ttt:order` | Work orders: carry a train batch from claim to Done |
| `/ttt:status` | Show or modify task status |
| `/ttt:show` | Show issue details or search issues |

### Auto-Activated Skill

The plugin includes a `managing-linear-tasks` skill that automatically activates when working with tasks, providing workflow guidance and best practices.

## License

MIT
