# team-toon-tack (ttt)

繁體中文 | [English](./README.md)

為 Claude Code 最佳化的任務工作流 — 支援 Linear 和 Trello，比 MCP 節省大量 token。

## 特色功能

- **節省 Token** — 本地 cycle 快取避免重複 API 呼叫，比 MCP 省下大量 token
- **多來源支援** — 支援 Linear 和 Trello
- **批次領票** — `ttt claim` 可一次領一張或多張票，`ttt claim next <n>` 自動領取最高優先級的待辦任務
- **工單** — 一個列車批次一份檔案，把這批票從領票帶到 Done：`ttt claim --order` 領票入單，合併後 `ttt order close` 一次完成整批
- **多團隊支援** — 跨多個團隊/看板同步與過濾 issue
- **彈性同步模式** — 選擇 remote（即時同步）或 local（離線優先，稍後用 `--update` 同步）
- **完成模式** — 四種任務完成模式（Linear）：簡單、嚴格審查、上下游嚴格、上下游非嚴格
- **QA 團隊支援** — 完成開發任務時自動將 QA 團隊的 parent issue 更新為「Testing」（Linear）
- **附件下載** — 自動下載圖片和檔案到本地 `.ttt/output/`，供 AI 視覺分析
- **阻塞狀態** — 等待外部依賴時可設定任務為 blocked
- **持久化估時** — 把人類工程工時估算寫進本地資料，後續 `ttt sync` 不會洗掉
- **Claude Code Plugin** — 安裝 plugin 即可使用 `/ttt:*` 指令和自動啟用的技能
- **Cycle 歷史保存** — 本地 `.toon` 檔案保留 cycle 資料，方便 AI 檢閱

## 快速開始

### 1. 安裝與初始化

```bash
npm install -g team-toon-tack

# Linear 用
export LINEAR_API_KEY="lin_api_xxxxx"

# Trello 用
export TRELLO_API_KEY="your-api-key"
export TRELLO_TOKEN="your-token"

cd your-project
ttt init
```

初始化時會提示選擇任務來源（Linear 或 Trello），然後設定：

**Linear：**
- **開發團隊**：你的開發團隊（單選）
- **開發團隊測試狀態**：開發團隊的 testing/review 狀態（可選）
- **QA 團隊**：跨團隊 parent issue 更新，各自設定 testing 狀態（可選）
- **完成模式**：任務完成時的處理方式（見下方說明）
- **狀態來源**：`remote`（即時更新 Linear）或 `local`（離線工作，用 `ttt sync --update` 同步）

**Trello：**
- **看板**：要同步的 Trello 看板
- **使用者**：你的 Trello 使用者名稱
- **狀態映射**：將 Trello 列表映射到 Todo（支援多個列表）/In Progress/Done
- **標籤過濾**：可選的卡片過濾標籤

### 完成模式（僅 Linear）

| 模式 | 行為 |
|------|------|
| `simple` | 任務標記為 Done，parent 也標記為 Done。未設定 QA 團隊時的預設值。 |
| `strict_review` | 任務標記到開發團隊的 testing 狀態，parent 標記到 QA 團隊的 testing 狀態。 |
| `upstream_strict` | 任務標記為 Done，parent 移動到 Testing。若無 parent，fallback 到開發團隊的 testing 狀態（此時任務直接進 testing，不會先寫 Done）。設定 QA 團隊時的預設值。 |
| `upstream_not_strict` | 任務標記為 Done，parent 移動到 Testing。若無 parent 不做 fallback。 |

> **注意**：Trello 因不支援 parent issue，一律使用簡單完成模式。

### 2. 安裝 Claude Code Plugin（選擇性）

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

### 3. 每日工作流

在 Claude Code 中（安裝 plugin 後）：

```
/ttt:sync              # 取得當前 cycle 所有 issue/card
/ttt:work-on next      # 領取最高優先級的票並開始工作
/ttt:estimate MP-123 6 # 寫入本地 6 小時估時
/ttt:done              # 完成任務，附上 AI 生成的摘要
```

或直接使用 CLI：

```bash
ttt sync
ttt claim next
ttt estimate MP-123 6
ttt done -m "完成任務"
```

---

## CLI 參考

### `ttt init`

在當前目錄初始化配置。

```bash
ttt init                           # 互動模式（選擇來源）
ttt init --source=linear           # 初始化 Linear
ttt init --source=trello           # 初始化 Trello
ttt init --user alice@example.com  # 預選使用者
ttt init --label Frontend          # 設定預設標籤
ttt init --force                   # 覆蓋現有配置
```

### `ttt sync`

從 Linear/Trello 同步當前 cycle 的 issue。

只同步指派給 `current_user` 的 issue。若要同步整個團隊，把 `.ttt/local.toon` 的
`current_user` 留空。

```bash
ttt sync              # 同步 Todo/In Progress 狀態的 issue（較快）
ttt sync --all        # 同步所有狀態的 issue
ttt sync MP-123       # 只同步特定 issue
ttt sync --update     # 將本地狀態推送到遠端（local 模式用）
```

### `ttt claim`

領票：把票在本地與遠端來源改成 in-progress。
別名：`ttt work-on`。

```bash
ttt claim                  # 互動多選
ttt claim MP-123           # 領一張票
ttt claim MP-123 MP-124    # 批次領票
ttt claim next             # 領最高優先級的待辦任務
ttt claim next 3           # 領最高優先級的前 3 張票
ttt claim --dry-run        # 預覽，不改狀態
ttt claim MP-123 --order auto --project app   # 同時記進該專案目前開著的工單
```

已完成、審核中、blocked 的票會逐張回報並跳過，不中斷整批。
本地資料沒有的 ID（例如不在 cycle 內的 Backlog 票）會從來源抓回、存進本地，再照一般流程領票；
加 `--dry-run` 時只顯示、不存入。本地與來源都找不到的 ID，整批在動任何票之前中止。
已關閉（完成或取消）的票會回報並跳過。
注意：完整的 `ttt sync` 會依目前 cycle 重寫本地資料，不在 cycle 內的票下次同步後會消失（仍可用 `ttt done <id> --from-remote` 完成）。

加 `--order <id|auto>` 會把領到的票同時記進[工單](#ttt-order)。
`auto` 指該專案目前開著的工單；上一張已封單時，會開一張新的 `<project>/<YYYY-MM-DD>-<下一個字母>`。
`--project <name>` 指定 `auto` 用的專案（預設：`.ttt` 所在的目錄名稱）。
工單無法收票時（已封單、已交接、已關閉），會在領任何票之前拒絕。

### `ttt estimate`

把人類工程工時估算寫進 `.ttt/cycle.toon`，並在之後的同步中保留下來。

```bash
ttt estimate MP-123 6                         # 寫入 6 小時估時
ttt estimate 2.5                              # 對目前進行中的任務寫入 2.5 小時
ttt estimate MP-123 16 --note "API pending"   # 連同註記一起保存
ttt estimate MP-123 --clear                   # 移除既有估時
```

### `ttt done`

標記任務完成。

```bash
ttt done                         # 若只有一個進行中，自動選擇
ttt done MP-123                  # 指定 issue
ttt done MP-123 MP-124 -m "已隨 v1.2.0 合併"   # 一次完成多張票，共用說明
ttt done -m "修復了錯誤"           # 附上完成說明
ttt done MP-123 --from-remote    # 從遠端取得（略過本地資料檢查）
ttt done MP-123 --commit 1a2b3c4 # 記錄指定 commit，而非目前 HEAD
ttt done MP-123 --commit 1a2b3c4 --repo ~/projects/app   # ...從另一個 repository 讀取
```

當 issue 存在於遠端但未同步到本地資料，或 ticket 仍是 Todo、想不經 `ttt claim`（不多一次 In Progress 轉換）直接完成時，使用 `--from-remote`（或 `-r`）。不加此參數時，`ttt done` 只接受進行中的任務。

要關閉 commit 早已合併的 ticket，用 `--commit <sha>`（commit 在另一個 checkout 時再加 `--repo <path>`）。未指定時記錄目前的 HEAD。

一次給多個 ID 時，`-m`、`--commit`、`--repo`、`--from-remote` 套用到每一張票。
每張票各有一行結果，其中一張失敗不會中斷其他票。
已經完成的票只回報、不重做，所以部分失敗後可以原指令重跑。
只要有一張失敗，結束碼就不是 0。
整批列車合併後要一次關票，改用[工單](#ttt-order)。

### `ttt order`

工單（work order）是一個列車批次一份的 TOON 檔。
它把這一批票從領票帶到 Done，每張票的分支、MR、head、審查結論與通過的測試紀錄都記在同一處。
多張票搭同一條整合分支、合併後一起關票時使用。

```bash
# 協調者（票還在做的期間，唯一的寫入者）
ttt claim MP-1 MP-2 --order auto --project app      # 領票並寫進該專案目前開著的工單
ttt order set app/2026-11-11-a MP-1 --branch feat/mp-1 --mr '!812' --head 1a2b3c4 \
    --review "P0/P1=0" --tests "bun test scripts/x = pass"
ttt order review app/2026-11-11-a MP-1 MP-2         # 改到測試狀態，指派人不變
ttt order train app/2026-11-11-a --branch agent-train/2026-11-11-a --mr '!900'
ttt order seal app/2026-11-11-a --gated-head 5d6e7f8   # 封單，不再收票
ttt order export app/2026-11-11-a --handoff         # 把輸出的區塊貼進列車 MR

# 整合者（交接後的寫入者）
glab mr view 900 | ttt order import -               # 從任何文字中取出工單區塊
ttt order close app/2026-11-11-a --merged 9a8b7c6 --version v1.2.0 --dry-run
ttt order close app/2026-11-11-a --merged 9a8b7c6 --version v1.2.0
```

| 指令 | 作用 |
|------|------|
| `open [<project>/<code>] [--project p] [--reviewer r]` | 開工單。不給 id 時，代碼為 `<YYYY-MM-DD>-<下一個字母>`。 |
| `list [--project p] [--all]` | 列出工單；加 `--all` 才列已關閉的。 |
| `show <id> [--toon]` | 顯示工單，或印出儲存的 TOON。 |
| `set <id> <ticket> [--branch --mr --head --review --tests]` | 記錄 worker 回報的內容。每個 `--tests "<指令> [@ <sha>] [= <結果>]"` 追加一筆測試紀錄；SHA 預設為該票的 head，結果預設為 `pass`。 |
| `review <id> <ticket>... [--status name]` | 把票改到測試狀態（`status_transitions.testing`，沒有則用 `dev_testing_status`），並在工單標為 in-review。 |
| `train <id> [--branch b] [--mr mr]` | 記錄列車分支與它的 MR。 |
| `seal <id> --gated-head <sha>` | 以通過 gate 的 head 封單。每張票都必須已送審或已剔除。 |
| `drop <id> <ticket> --reason <text>` | 把票從這一批剔除，遠端狀態不動。 |
| `export <id> [--handoff]` | 把工單印成一個 fenced 區塊。加 `--handoff` 後本機這份改為唯讀。 |
| `import <file\|-> [--id id] [--force]` | 從檔案或 stdin 取出區塊；匯入者成為寫入者。 |
| `reclaim <id>` | 對方退回但沒有匯出時，把已交接的工單收回。 |
| `close <id> --merged <sha> [--version v] [--dry-run]` | 完成每張送審中的票，並各留一則留言。 |

工單的規則：

- **儲存。** 工單存在寫入者機器上的 `.ttt/orders/<project>/<code>.toon`，不進版控。寫入先寫暫存檔再改名，並以每個專案一把鎖排隊。預設專案是 `.ttt` 所在的目錄名稱。
- **階段。** `open` → `sealed` → `merged` → `closed`。一個專案同時只有一張開著的工單。封單之後，`ttt claim --order auto` 會開下一張；被退回的票留在原工單重做：用 `set` 記下新的 head，再 `seal` 一次。
- **單一寫入者。** Worker 回報，協調者記錄。`export --handoff` 把寫入權交給整合者；之後在已交接的那份上執行寫入指令會被拒絕，訊息會說明怎麼拿回來：匯入對方退回的版本，或執行 `reclaim`。匯入時，本機那份若仍可寫，沒有 `--force` 不會被覆蓋；版本比本機舊的也不會被接受。
- **關單。** 每張送審中的票走與 `ttt done` 相同的完成流程，所以 `completion_mode` 與上層 issue 的規則照常套用。每張票各有一則留言，寫明它的 MR、合併 commit、版本與工單 id。已剔除的票不動。遠端已取消的票會讓關單停下，剔除後才能繼續。重跑時，已完成的票會跳過，留言不會重複。
- **身分。** `owner` 與紀錄中的寫入者名稱取自 `TTT_ACTOR`，未設定時為 `<current_user>@<hostname>`。

一張票同一時間只搭一張工單：要領進第二張工單，必須先從第一張剔除。

### `ttt status`

顯示或修改任務狀態。

```bash
ttt status              # 顯示當前進行中的任務
ttt status MP-123       # 顯示特定 issue 狀態
ttt status MP-123 --set +1      # 移動到下一狀態
ttt status MP-123 --set done    # 標記為完成
ttt status MP-123 --set blocked # 設為阻塞（等待外部依賴）
```

### `ttt show`

顯示 issue 詳情或搜尋 issue。

```bash
ttt show                       # 顯示本地 cycle 資料中的所有 issue
ttt show MP-123                # 顯示特定 issue（從本地資料）
ttt show MP-123 --remote       # 從遠端取得特定 issue
ttt show --label frontend      # 依標籤過濾
ttt show --status "In Progress" --user me   # 我進行中的 issue
ttt show --priority 1          # 顯示緊急 issue
ttt show --export              # 輸出為 markdown 格式
ttt show --remote --status Backlog --creator me   # 我建立的 Backlog 票
ttt show --remote --status Backlog --user me      # 指派給我的 Backlog 票
ttt show --remote --any-cycle --creator me        # 我建立、不限 cycle 的票
```

兩個選項可把 `--remote` 搜尋範圍放寬到 `ttt sync` 之外（都必須搭配 `--remote`，否則直接報錯，不會默默忽略）：

- `--creator <me|email|name>`：依建立者過濾（僅 Linear；Trello 卡片沒有建立者，會報錯）。
  未指定 `--user` 時會解除指派對象的限制，因此你建給別人或未指派的票也找得到。
- `--any-cycle`：不限目前 cycle。`--status Backlog` 會自動帶上它，因為 Backlog 票通常不屬於任何 cycle。
  Trello 沒有 cycle，所以在 Trello 上沒有作用。

### `ttt config`

配置設定。

```bash
ttt config              # 顯示當前配置
ttt config status       # 配置狀態映射
ttt config filters      # 配置標籤/使用者過濾
ttt config teams        # 配置多團隊選擇
```

## 配置說明

### 目錄結構

```
your-project/
└── .ttt/
    ├── config.toon     # 團隊配置（建議 gitignore）
    ├── local.toon      # 個人設定（gitignore）
    ├── cycle.toon      # 當前 cycle 資料與本地估時（自動產生）
    ├── orders/         # 工單：<project>/<code>.toon（不要 commit）
    └── output/         # 下載的附件（圖片、檔案）
```

### 環境變數

| 變數 | 說明 |
|------|------|
| `LINEAR_API_KEY` | **Linear 必填**。你的 Linear API 金鑰 |
| `TRELLO_API_KEY` | **Trello 必填**。你的 Trello API 金鑰 |
| `TRELLO_TOKEN` | **Trello 必填**。你的 Trello 授權 token |
| `TOON_DIR` | 配置目錄（預設：`.ttt`） |
| `TTT_ACTOR` | 工單中的寫入者名稱（預設：`<current_user>@<hostname>`） |

### Trello 設定

1. 從 https://trello.com/power-ups/admin 取得 API 金鑰
2. 在 `ttt init` 時會顯示授權網址，前往取得 token
3. 在環境變數中設定 `TRELLO_API_KEY` 和 `TRELLO_TOKEN`

### 概念對照：Linear vs Trello

| 概念 | Linear | Trello |
|------|--------|--------|
| 容器 | Team | Board（看板）|
| 任務 | Issue | Card（卡片）|
| 狀態 | Workflow State | List（列表）|
| 標籤 | Label | Label |
| 週期 | Cycle | -（不支援）|
| 上層 | Parent Issue | -（不支援）|

## Claude Code Plugin

安裝 plugin 以整合 Claude Code：

```
/plugin marketplace add wayne930242/team-toon-tack
/plugin install team-toon-tack@ttt-marketplace
```

### 可用指令

| 指令 | 說明 |
|------|------|
| `/ttt:sync` | 同步 issue 到本地 |
| `/ttt:work-on` | 領票並開始處理 |
| `/ttt:estimate` | 寫入本地人力估時 |
| `/ttt:done` | 標記一張或多張任務完成 |
| `/ttt:order` | 工單：把一批列車的票從領票帶到 Done |
| `/ttt:status` | 顯示或修改任務狀態 |
| `/ttt:show` | 顯示 issue 詳情或搜尋 issue |

### 自動啟用技能

Plugin 包含 `managing-linear-tasks` 技能，在處理任務時會自動啟用，提供工作流程指導和最佳實踐。

## 授權

MIT
