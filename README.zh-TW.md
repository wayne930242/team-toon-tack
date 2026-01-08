# team-toon-tack (ttt)

繁體中文 | [English](./README.md)

使用 TOON 格式同步與管理 Linear 任務的 CLI 工具。

## 為什麼需要這個工具？

在使用 Linear 管理專案任務時，常見的痛點：

- **AI 助手整合困難**：Claude Code 等 AI 工具無法直接讀取 Linear 的任務上下文
- **狀態同步繁瑣**：手動在 Linear 和本地之間切換更新狀態
- **團隊協作不透明**：難以追蹤誰在做什麼、進度如何

**team-toon-tack** 解決這些問題：將 Linear 任務同步到本地 TOON 檔案，讓 AI 助手能讀取任務內容，並自動同步狀態變更。

## 運作原理

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Linear    │────▶│  ttt sync    │────▶│ cycle.toon  │
│   (雲端)    │     │              │     │  (本地)     │
└─────────────┘     └──────────────┘     └─────────────┘
                                                │
                                                ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Linear    │◀────│  ttt done    │◀────│ Claude Code │
│  狀態更新   │     │  ttt work-on │     │  讀取任務   │
└─────────────┘     └──────────────┘     └─────────────┘
```

### 核心流程

1. **同步 (sync)**
   - 從 Linear API 抓取當前 Cycle 的任務
   - 根據 `local.toon` 設定過濾（標籤、排除指派人）
   - 寫入 `cycle.toon`，包含完整任務資訊

2. **開始任務 (work-on)**
   - 讀取 `cycle.toon` 中的待處理任務
   - 更新本地狀態為 `in-progress`
   - 同步更新 Linear 狀態為 "In Progress"

3. **完成任務 (done)**
   - 更新本地狀態為 `completed`
   - 同步更新 Linear 狀態為 "Done"
   - 自動在 Linear 新增完成留言（含 commit 資訊）
   - 若有父任務，自動更新為 "Testing"

### 檔案結構與用途

```
.toon/                    # 配置目錄（建議 gitignore）
├── config.toon          # 團隊配置
│   ├── teams            # Linear 團隊 ID 映射
│   ├── users            # 成員 ID/email 映射
│   ├── labels           # 標籤 ID 映射
│   ├── statuses         # 狀態定義
│   └── current_cycle    # 當前 Cycle 資訊
│
├── local.toon           # 個人設定（必須 gitignore）
│   ├── current_user     # 你的 user key
│   ├── label            # 過濾標籤
│   └── exclude_assignees # 排除的指派人
│
└── cycle.toon           # 任務資料（自動產生）
    ├── cycleId          # Cycle UUID
    ├── cycleName        # Cycle 名稱
    ├── updatedAt        # 最後同步時間
    └── tasks[]          # 任務列表
        ├── id           # 任務編號 (MP-123)
        ├── linearId     # Linear UUID
        ├── title        # 標題
        ├── description  # 描述（Markdown）
        ├── status       # Linear 狀態
        ├── localStatus  # 本地狀態
        ├── priority     # 優先級 (1=Urgent, 4=Low)
        ├── labels       # 標籤列表
        ├── branch       # Git 分支名
        ├── attachments  # 附件列表
        └── comments     # 留言列表
```

## 安裝

```bash
# npm（推薦）
npm install -g team-toon-tack

# 或用 bun
bun add -g team-toon-tack
```

## 快速開始

```bash
# 1. 設定 Linear API 金鑰
export LINEAR_API_KEY="lin_api_xxxxx"

# 2. 初始化（會從 Linear 抓取團隊資料）
mkdir .toon && cd .toon
ttt init

# 3. 同步任務
ttt sync

# 4. 開始工作
ttt work-on
```

## 使用情境

### 情境 1：每日開工流程

```bash
# 早上開始工作前，同步最新任務
ttt sync -d .toon

# 查看待處理任務並選擇一個開始
ttt work-on -d .toon

# Claude Code 現在可以讀取任務內容
# 在 .toon/cycle.toon 中找到任務描述、附件等
```

### 情境 2：搭配 Claude Code 自動化

建立以下三個 slash command 檔案：

#### `.claude/commands/sync-linear.md`

```markdown
---
name: sync-linear
description: Sync Linear issues to local TOON file
---

# Sync Linear Issues

Fetch current cycle's issues from Linear to `.toon/cycle.toon`.

## Process

### 1. Run Sync

\`\`\`bash
ttt sync -d .toon
\`\`\`

### 2. Review Output

Script displays a summary of tasks in the current cycle.

## When to Use

- Before starting a new work session
- When task list is missing or outdated
- After issues are updated in Linear
```

#### `.claude/commands/work-on.md`

```markdown
---
name: work-on
description: Select and start working on a Linear issue
arguments:
  - name: issue-id
    description: "Issue ID (e.g., MP-624) or 'next' for auto-select"
    required: false
---

# Start Working on Issue

Select a task and update status to "In Progress" on both local and Linear.

## Process

### 1. Run Command

\`\`\`bash
ttt work-on -d .toon $ARGUMENTS
\`\`\`

### 2. Review Issue Details

Script displays title, description, priority, labels, and attachments.

### 3. Implement

1. Read the issue description carefully
2. Explore related code
3. Implement the fix/feature
4. Run validation commands
5. Commit with conventional format
6. Use `/done-job` to complete
```

#### `.claude/commands/done-job.md`

```markdown
---
name: done-job
description: Mark a Linear issue as done with AI summary comment
arguments:
  - name: issue-id
    description: Linear issue ID (e.g., MP-624). Optional if only one task is in-progress
    required: false
---

# Complete Task

Mark a task as done and update Linear with commit details.

## Process

### 1. Determine Issue ID

Check `.toon/cycle.toon` for tasks with `localStatus: in-progress`.

### 2. Write Fix Summary

Prepare a concise summary (1-3 sentences) covering:
- Root cause
- How it was resolved
- Key code changes

### 3. Run Command

\`\`\`bash
ttt done -d .toon $ARGUMENTS -m "修復說明"
\`\`\`

## What It Does

- Linear issue status → "Done"
- Adds comment with commit hash, message, and diff summary
- Parent issue (if exists) → "Testing"
- Local status → `completed` in `.toon/cycle.toon`
```

#### 使用方式

```
/sync-linear        # 同步任務
/work-on            # 互動選擇任務
/work-on MP-624     # 指定任務
/work-on next       # 自動選最高優先級
/done-job           # 完成當前任務
/done-job MP-624    # 完成指定任務
```

Claude Code 會自動：
- 執行 `ttt work-on` 開始任務
- 讀取任務描述和附件
- 根據需求實作功能
- 執行 `ttt done` 更新狀態並留言

### 情境 3：完成任務並自動留言

```bash
# 完成開發後
git add . && git commit -m "feat: implement feature X"

# 標記任務完成，會自動在 Linear 新增留言
ttt done -d .toon -m "實作了 X 功能，修改了 Y 元件"
```

Linear 上會自動新增留言：
```markdown
## ✅ 開發完成

### 🤖 AI 修復說明
實作了 X 功能，修改了 Y 元件

### 📝 Commit Info
**Commit:** [abc1234](https://github.com/...)
**Message:** feat: implement feature X

### 📊 Changes
 src/components/X.vue | 50 +++
 src/utils/Y.ts       | 20 +-
 2 files changed, 60 insertions(+), 10 deletions(-)
```

### 情境 4：團隊協作過濾

前端工程師只想看前端任務：
```toon
# local.toon
current_user: alice
label: Frontend
exclude_assignees[1]: bob    # 排除後端同事的任務
exclude_assignees[2]: charlie
```

後端工程師的設定：
```toon
# local.toon
current_user: bob
label: Backend
```

### 情境 5：多專案管理

```bash
# 專案 A
cd project-a
ttt sync -d .toon

# 專案 B（不同 Linear 團隊）
cd ../project-b
ttt init -d .toon  # 初始化不同的配置
ttt sync -d .toon
```

### 情境 6：CI/CD 整合

```yaml
# .github/workflows/sync.yml
name: Sync Linear Tasks
on:
  schedule:
    - cron: '0 9 * * 1-5'  # 週一到週五早上 9 點
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g team-toon-tack
      - run: ttt sync -d .toon
        env:
          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
      - run: |
          git add .toon/cycle.toon
          git commit -m "chore: sync linear tasks" || true
          git push
```

## 指令參考

### `ttt init`

初始化配置檔，從 Linear 抓取團隊資料。

```bash
ttt init [options]

選項：
  -d, --dir <path>      配置目錄（預設：當前目錄）
  -k, --api-key <key>   Linear API 金鑰
  -u, --user <email>    預選使用者
  -l, --label <name>    預設標籤過濾
  -f, --force           覆蓋現有配置
  -y, --yes             非互動模式
```

### `ttt sync`

從 Linear 同步任務到本地。

```bash
ttt sync [options]

選項：
  -d, --dir <path>      配置目錄
```

### `ttt work-on`

開始處理任務。

```bash
ttt work-on [issue-id] [options]

參數：
  issue-id              任務編號（如 MP-624）或 "next"

選項：
  -d, --dir <path>      配置目錄
```

### `ttt done`

標記任務完成。

```bash
ttt done [issue-id] [options]

參數：
  issue-id              任務編號（可選）

選項：
  -d, --dir <path>      配置目錄
  -m, --message <msg>   完成說明
```

## 環境變數

| 變數 | 說明 |
|------|------|
| `LINEAR_API_KEY` | **必填**。Linear API 金鑰（[取得方式](https://linear.app/settings/api)） |
| `TOON_DIR` | 配置目錄路徑（可取代 `-d` 參數） |

## 常見問題

### Q: 為什麼用 TOON 格式？

TOON 是一種人類可讀的資料格式，類似 YAML 但更簡潔。相比 JSON：
- 更容易手動編輯
- 支援註解
- AI 助手更容易理解

### Q: config.toon 可以提交到 Git 嗎？

可以，但建議 gitignore。因為包含：
- 團隊成員的 email
- Linear 內部 UUID

如果是私有倉庫且團隊成員都有 Linear 存取權，提交是安全的。

### Q: 如何處理衝突？

`cycle.toon` 是自動產生的，直接用 `ttt sync` 重新同步即可。

### Q: 支援哪些 Linear 功能？

- ✅ Cycle 任務同步
- ✅ 狀態雙向同步
- ✅ 附件和留言讀取
- ✅ 父子任務關聯
- ✅ 優先級排序

## 授權

MIT
