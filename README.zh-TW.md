# team-toon-tack (ttt)

繁體中文 | [English](./README.md)

為 Claude Code 最佳化的任務工作流 — 支援 Linear、Trello，以及不用帳號的本機看板，比 MCP 節省大量 token。

## 特色功能

- **節省 Token** — 本地 cycle 快取避免重複 API 呼叫，比 MCP 省下大量 token
- **多來源支援** — 支援 Linear、Trello，或存在 `.ttt` 的本機看板（不用登入），之後可用 `ttt migrate --to linear` 搬進 Linear
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

# 完全不用帳號：本機看板存在 .ttt/local
ttt init --source local --team MP -y
```

初始化時會提示選擇任務來源（Linear、Trello 或本機看板），然後設定：

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

**本機看板**（見[本機看板](#本機看板)）：
- **團隊代號**：issue 前綴（`MP` → `MP-1`、`MP-2`……）
- **你與團隊**：你的名字、可選的 email、其他成員
- **狀態**：依工作流程排序，預設 Backlog、Todo、In Progress、In Review、Done、Canceled
- **標籤**：可不填

### 完成模式（僅 Linear）

| 模式 | 行為 |
|------|------|
| `simple` | 任務標記為 Done，parent 也標記為 Done。未設定 QA 團隊時的預設值。 |
| `strict_review` | 任務標記到開發團隊的 testing 狀態，parent 標記到 QA 團隊的 testing 狀態。 |
| `upstream_strict` | 任務標記為 Done，parent 移動到 Testing。若無 parent，fallback 到開發團隊的 testing 狀態（此時任務直接進 testing，不會先寫 Done）。設定 QA 團隊時的預設值。 |
| `upstream_not_strict` | 任務標記為 Done，parent 移動到 Testing。若無 parent 不做 fallback。 |

> **注意**：Trello 與本機看板一律使用簡單完成模式：`ttt done` 把任務移到 Done 並留 commit 訊息。

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
ttt init --source local --team MP  # 本機看板，issue 編號 MP-1、MP-2……
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

本機看板沒有人派票，所以沒有指派給你的待辦時，`next` 會改領 Todo 狀態、未指派的票，
領了也不會指派給你。

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

# 從列車拉下來的票，紀錄跟著走
ttt order return app/2026-11-11-a MP-2 --reason "等 MP-9" > notice.md   # 整合者
ttt order carry MP-2 --to auto --project app --text notice.md           # 協調者：帶進下一張工單

# 整合期間要修的票
ttt order rework app/2026-11-11-a MP-1 --reason "gate 紅燈"   # 退回 in-progress；已封的工單重新打開
```

| 指令 | 作用 |
|------|------|
| `open [<project>/<code>] [--project p] [--reviewer r]` | 開工單。不給 id 時，代碼為 `<YYYY-MM-DD>-<下一個字母>`。 |
| `list [--project p] [--all]` | 列出工單；加 `--all` 才列已關閉的。 |
| `show <id> [--toon]` | 顯示工單，或印出儲存的 TOON。 |
| `set <id> <ticket> [--branch --mr --head --review --tests]` | 記錄 worker 回報的內容。每個 `--tests "<指令> [@ <sha>] [= <結果>]"` 追加一筆測試紀錄；SHA 預設為該票的 head，結果預設為 `pass`。審查結論綁定記錄當下的 head。 |
| `review <id> <ticket>... [--status name]` | 把票改到測試狀態（`status_transitions.testing`，沒有則用 `dev_testing_status`），並在工單標為 in-review。 |
| `train <id> [--branch b] [--mr mr]` | 記錄列車分支與它的 MR。 |
| `seal <id> --gated-head <sha>` | 以通過 gate 的 head 封單。每張票都必須已送審、已剔除或已退回。 |
| `drop <id> <ticket> --reason <text>` | 把票從這一批剔除，遠端狀態不動。 |
| `rework <id> <ticket> --reason <text>` | 把送審中的票退回 in-progress，工單與遠端一起改，指派人不變。已封的工單會重新打開，並清掉 gated head。 |
| `return <id> <ticket>... --reason <text>` | 寫入者（通常是整合者）把票退回給協調者：標為 returned、遠端改回 in-progress，並印出退回通知區塊。可重複執行。 |
| `carry <ticket>... --to <id\|auto> [--project p] [--from id \| --text file\|-]` | 協調者把票帶進另一張開著的工單，分支、MR、head、審查結論與測試紀錄一併帶過去，並記下 `carried_from`。 |
| `export <id> [--handoff]` | 把工單印成一個 fenced 區塊。加 `--handoff` 後本機這份改為唯讀。 |
| `import <file\|-> [--id id] [--force] [--returns \| --order]` | 從檔案或 stdin 取出區塊；匯入者成為寫入者。若是退回通知，只記到本機那份工單上，寫入者不變。 |
| `reclaim <id>` | 對方退回但沒有匯出時，把已交接的工單收回。 |
| `close <id> --merged <sha> [--version v] [--dry-run]` | 完成每張送審中的票，並各留一則留言。 |

工單的規則：

- **儲存。** 工單存在寫入者機器上的 `.ttt/orders/<project>/<code>.toon`，不進版控。寫入先寫暫存檔再改名，並以每個專案一把鎖排隊。預設專案是 `.ttt` 所在的目錄名稱。
- **階段。** `open` → `sealed` → `merged` → `closed`。一個專案同時只有一張開著的工單。封單之後，`ttt claim --order auto` 會開下一張。要在原工單內修的票用 `rework`：工單回到 `open`、gated head 清空，接著用 `set` 記下新的 head、`review` 送審，再 `seal` 一次。
- **票的狀態。** `in-progress`、`in-review`、`dropped`、`returned`、`done`。已剔除或已退回的票不會被 `close` 完成，不會擋住 `seal` 與 `close`，也可以被另一張工單收走。
- **退回與帶票。** `return` 保留票的紀錄，並記下誰退回、何時、原因。它印出的通知（`toon ttt-return` fenced 區塊）帶著這些票的完整紀錄。協調者 `import` 這份通知時，只記到自己那份工單上，已交接的那份也收，而且維持唯讀；文字裡同時有工單區塊與通知時，要用 `--returns` 或 `--order` 指定。`carry` 的紀錄來源是本機的工單（`--from`，沒給就找該專案最新一張含這張票的工單），或 `--text` 裡的通知或工單區塊；票進到目的工單時是 in-progress（`auto` 指該專案開著的工單，沒有就開一張）。來源工單若由本機寫入，票會標為剔除，原因是 `carried to <order>`。別處的寫入者還握著的票（在已交接的工單裡仍是 in-progress 或 in-review）會被拒絕，要等對方退回。`carry` 不改遠端狀態。
- **審查過期。** 記錄審查結論時的 head 存在 `review_head`。之後 `set --head` 換了 head 卻沒有新的 `--review`，`show` 會標出 `stale: reviewed <舊>, head now <新>`，`seal` 也會警告。測試紀錄維持各自執行時的 SHA。在這個欄位出現之前寫的工單不會被標記。
- **單一寫入者。** Worker 回報，協調者記錄。`export --handoff` 把寫入權交給整合者；之後在已交接的那份上執行寫入指令會被拒絕，訊息會說明怎麼拿回來：匯入對方退回的版本，或執行 `reclaim`。匯入時，本機那份若仍可寫，沒有 `--force` 不會被覆蓋；版本比本機舊的也不會被接受。
- **關單。** 每張送審中的票走與 `ttt done` 相同的完成流程，所以 `completion_mode` 與上層 issue 的規則照常套用。每張票各有一則留言，寫明它的 MR、合併 commit、版本與工單 id。已剔除與已退回的票不動。遠端已取消的票會讓關單停下，剔除後才能繼續。重跑時，已完成的票會跳過，留言不會重複。
- **身分。** `owner` 與紀錄中的寫入者名稱取自 `TTT_ACTOR`，未設定時為 `<current_user>@<hostname>`。

一張票同一時間只搭一張工單：要領進或帶進第二張工單，必須先從第一張剔除或退回。

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

### `ttt skills` / `ttt skill`

印出隨這個版本的 CLI 一起安裝的 agent 技能說明。
Agent 那邊只裝一份短的引導技能，內容是要它執行這兩個指令，所以 agent 照著做的說明一定和裝著的 `ttt` 同一版。

```bash
ttt skills                                         # 內建的技能、各自的分頁與 ttt 版本
ttt skill managing-linear-tasks                    # 印出技能；開頭列出有哪些分頁
ttt skill managing-linear-tasks orders-coordinator # 工單：協調者這一側
ttt skill managing-linear-tasks orders-integrator  # 工單：整合者這一側
```

說明文字放在套件裡的 `bundled-skills/<name>/index.md`（每個分頁另有一份 `<page>.md`），讀取時以安裝的套件目錄為準，與目前所在的目錄無關。

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

### 本機看板

`ttt init --source local` 在 `.ttt/local` 存一個與 Linear 同形的工作看板，不用登入
Linear 或 Trello。所有指令照常可用：`create`、`show`（`--remote` 讀整個看板）、
`status`、`assign`、`edit`、`cancel`、`comment`、`claim`、`done`、`estimate` 與工單。
`ttt sync` 沒有東西可同步，會直接說明。

```bash
ttt init --source local --team MP --user "Alice" --members "Bob,Carol" \
  --labels "Bug,Feature" -y
ttt create -t "Fix login" -p 2 -l Bug --estimate 3
ttt create -t "Write the test" --parent MP-1
ttt edit MP-2 --blocked-by MP-1
ttt claim next
ttt done MP-1 -m "Fixed"
```

`--statuses "Todo, Doing, Review:started, Shipped:completed, Dropped"` 可自訂工作流程；
每個狀態都有 Linear 的狀態類型（`backlog`、`unstarted`、`started`、`completed`、
`canceled`），寫在 `:` 後面，或由名稱推斷。init 依類型決定 claim、done、review 要移到哪個狀態。
再跑一次 init 會保留看板上的 issue、編號與狀態，只加上新的標籤與成員。

磁碟上全是 TOON：

```
.ttt/local/
├── board.toon              # 團隊代號與名稱、next_number、狀態、標籤
├── issues/MP-1.toon        # 一個 issue 一個檔
└── migration-linear.toon   # ttt migrate 寫的對照與進度
```

issue 欄位有 `identifier`、`number`、`title`、`description`、`state`、`priority`、
`labels`、`assignee`、`estimate`、`parent`、`relations`（`blocks`、`blocked_by`、
`related`，兩邊的 issue 都會寫）、`comments`、`cycle`、`creator`、`created_at`／`updated_at`
（另有 `started_at`、`completed_at`、`canceled_at`）。子 issue 就是指向某個 parent 的 issue。
編號在鎖檔保護下由 `next_number` 配發，兩個同時跑的 `ttt create` 會拿到不同編號，
同一個編號也不會發第二次。使用者仍記在 `config.toon`；沒填 email 的使用者記為 `<名字>@local`。

`.ttt` 在 `.gitignore` 裡，看板只存在這個工作目錄：請自行備份，或搬到 Linear。

#### 搬到 Linear

```bash
export LINEAR_API_KEY="lin_api_xxxxx"
ttt migrate --to linear --dry-run          # 只列計畫，不寫任何東西
ttt migrate --to linear --team ENG         # 實際搬
ttt sync
```

migrate 在 Linear 團隊建立每個 issue，帶上狀態（同名，否則取同類型的第一個狀態）、
標籤（缺的會建立）、優先度、估點、負責人（先比 email 再比名字，對不上就不指派）、
parent、留言（第一行記原作者與日期）以及 blocks／related 關聯。每一步送出前都先把
Linear 將使用的 id 寫進 `.ttt/local/migration-linear.toon`，所以中途失敗或被中斷時，
用同一個指令重跑即可接續，不會重複建立 issue。全部成功後 `config.toon` 才切到 Linear；
`cycle.toon` 的任務改用新編號，本機看板留作紀錄。`.ttt/orders` 下的工單也同時改記
Linear 編號，所以 `ttt order review`、`close` 作用在搬過去的 issue 上，不會碰到別的
團隊剛好與本機編號相同的 issue；工單裡還在處理的票若已不在看板上，migrate 會拒絕執行。

重跑時，前一次已建立、之後又在本機改過的 issue，會以更新送出。執行期間持有
`.ttt/local/migration.lock`，同時啟動的第二次執行會被拒絕。計畫會列出搬不過去的部分：
不在團隊估點刻度上的估點、週期（cycle），以及建立者與開始、完成、取消日期（由 Linear
自行設定）。好幾位 Linear 使用者同名時一律不指派；要指定其中一位，請在 `config.toon`
填上該使用者的 email。

### 環境變數

| 變數 | 說明 |
|------|------|
| `LINEAR_API_KEY` | **Linear 必填**（`ttt migrate` 也要）。你的 Linear API 金鑰 |
| `TRELLO_API_KEY` | **Trello 必填**。你的 Trello API 金鑰 |
| `TRELLO_TOKEN` | **Trello 必填**。你的 Trello 授權 token |
| `TOON_DIR` | 配置目錄（預設：`.ttt`） |
| `TTT_ACTOR` | 工單中的寫入者名稱（預設：`<current_user>@<hostname>`） |

### Trello 設定

1. 從 https://trello.com/power-ups/admin 取得 API 金鑰
2. 在 `ttt init` 時會顯示授權網址，前往取得 token
3. 在環境變數中設定 `TRELLO_API_KEY` 和 `TRELLO_TOKEN`

### 概念對照：Linear vs Trello vs 本機看板

| 概念 | Linear | Trello | 本機看板 |
|------|--------|--------|----------|
| 容器 | Team | Board（看板）| `board.toon` 的團隊代號 |
| 任務 | Issue | Card（卡片）| `issues/<代號>-<n>.toon` |
| 狀態 | Workflow State | List（列表）| 帶狀態類型的狀態 |
| 標籤 | Label | Label | Label |
| 週期 | Cycle | -（不支援）| `current_cycle`（可不設）|
| 上層 | Parent Issue | -（不支援）| `parent` |
| 關聯 | Blocks / Related | -（不支援）| `relations` |

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

Plugin 包含 `managing-linear-tasks` 技能，在處理任務時會自動啟用。它只是一份短的引導：要 agent 執行 `ttt skill managing-linear-tasks`，印出隨 CLI 一起安裝的完整說明（見 [`ttt skills`](#ttt-skills--ttt-skill)）。

## 授權

MIT
