---
name: managing-linear-tasks
description: Use when the user mentions Linear or Trello issues, references issue IDs like MP-123, or asks to sync, show, start, complete, create, assign, edit, cancel, comment on, or check status of tasks.
---

## 執行方式

在 Codex 與 Claude Code 中，使用可用的 shell 工具執行 `ttt` CLI。
任務資料以 CLI 的查詢結果為準；透過 CLI 更新 `.ttt/` 內的設定與狀態。
使用者要求完成任務時，執行 `ttt done -m "摘要"`。
Claude Code 也提供 `/ttt:*` slash commands，對應下方相同的 CLI 操作。


# Task Manager (Linear/Trello)

Manage developer task workflows using the `ttt` CLI.

## Command Router

依使用者意圖選擇下列 `ttt` CLI 指令：

| User Intent | Command | Example |
|-------------|---------|---------|
| Sync/fetch issues | `ttt sync` | "sync my issues", "pull from Linear" |
| Show/search issues | `ttt show` | "show MP-624", "list my tasks", "what issues do I have" |
| Start working on a task | `ttt work-on` | "work on next", "start MP-624" |
| Create a new issue | `ttt create` | "create issue", "open a ticket", "new task" |
| Reassign an issue | `ttt assign` | "assign MP-624 to john", "reassign to jane" |
| Edit issue fields | `ttt edit` | "rename MP-624", "change priority", "update labels" |
| Cancel an issue | `ttt cancel` | "cancel MP-624", "abandon this task" |
| Record an estimate | `ttt estimate` | "estimate MP-624 as 6h", "save 2.5h estimate" |
| Check/change status | `ttt status` | "what's my current task", "set MP-624 to blocked" |
| Add a comment | `ttt comment` | "comment on MP-624", "add note to task" |
| Complete a task | `ttt done` | "done", "mark complete", "finish task" |

**意圖符合時，透過 shell 工具執行對應的 `ttt` CLI 指令。**

## Quick Reference

```bash
ttt sync                    # Sync Todo/In Progress issues
ttt sync --all              # Sync all statuses
ttt sync MP-624             # Sync specific issue
ttt show                    # List all local issues
ttt show MP-624             # Show issue details
ttt show --user me          # My issues
ttt work-on next            # Auto-select highest priority
ttt work-on MP-624          # Start specific task
ttt create                  # Create new issue (interactive)
ttt create -t "Title" -p 2  # Quick create with flags
ttt assign MP-624 -a john   # Reassign issue
ttt edit MP-624 -t "New"    # Edit title (or -d/-p/-l)
ttt cancel MP-624           # Cancel an issue
ttt estimate MP-624 6       # Save a 6-hour human estimate
ttt status                  # Current in-progress task
ttt status MP-624 --set +1  # Advance status
ttt comment MP-624 -m "msg" # Add comment to issue
ttt comment -m "msg"        # Comment on current task
ttt done -m "summary"       # Complete with message
```

## Prerequisites

- **Linear**: `LINEAR_API_KEY` env var set
- **Trello**: `TRELLO_API_KEY` + `TRELLO_TOKEN` env vars set
- `.ttt/` directory initialized (`ttt init`)

## Standard Workflow

```
ttt sync → ttt work-on next → ttt estimate <id> <hours> → [implement] → git commit → ttt comment -m "notes" → ttt done -m "..."
```

## File Structure

```
.ttt/
├── config.toon     # Team configuration
├── local.toon      # Personal settings
├── cycle.toon      # Current cycle tasks + local estimates (auto-generated)
└── output/         # Downloaded attachments
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No cycle data | `ttt sync` |
| Issue not found locally | `ttt show <id> --remote` or `ttt sync <id>` (`ttt status` auto-fetches from remote) |
| API key not set | Set `LINEAR_API_KEY` or `TRELLO_API_KEY` + `TRELLO_TOKEN` |
| Stale data | `ttt sync` to refresh |

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll edit `cycle.toon` directly, faster" | `cycle.toon` is auto-generated. Manual edits get overwritten on next `ttt sync`. Always go through the CLI. |
| "I remember this issue ID, no need to sync" | Remote status, assignee, priority may have changed. Run `ttt sync` or `ttt show <id> --remote` first. |
| "I'll create the issue in the Linear/Trello UI instead" | Bypassing `ttt create` leaves the new issue outside local cycle data. Use the CLI so it gets tracked. |
| "Task is obvious, skip `ttt done`" | `ttt done` syncs local + remote status, posts a completion comment, reads git commit info. Skipping leaves state inconsistent. |
| "I know what the task needs without reading it" | Fabricated assumptions produce wrong work. Run `ttt show <id>` before starting. |
| "Fetch issue details via Linear MCP / web UI" | The CLI is authoritative and token-efficient. Use `ttt show` / `ttt sync`, not alternate data paths. |

## Flowchart — Intent Routing

```dot
digraph ttt_router {
    rankdir=LR;

    user [label="User mentions\nLinear/Trello", shape=doublecircle];
    classify [label="Classify intent", shape=diamond];

    sync     [label="ttt sync",    shape=box];
    show     [label="ttt show",    shape=box];
    work_on  [label="ttt work-on", shape=box];
    create   [label="ttt create",  shape=box];
    assign   [label="ttt assign",  shape=box];
    edit     [label="ttt edit",    shape=box];
    cancel   [label="ttt cancel",  shape=box];
    estimate [label="ttt estimate", shape=box];
    status   [label="ttt status",  shape=box];
    comment  [label="ttt comment", shape=box];
    done     [label="ttt done",    shape=box];

    user -> classify;
    classify -> sync     [label="fetch / pull"];
    classify -> show     [label="show / list"];
    classify -> work_on  [label="start / next"];
    classify -> create   [label="create / new"];
    classify -> assign   [label="assign / reassign"];
    classify -> edit     [label="rename / change field"];
    classify -> cancel   [label="cancel / abandon"];
    classify -> estimate [label="estimate / Nh"];
    classify -> status   [label="current / set status"];
    classify -> comment  [label="comment / note"];
    classify -> done     [label="done / complete"];
}
```
