# team-toon-tack (ttt)

繁體中文 | [English](./README.md)

為 Claude Code 最佳化的任務工作流 — 支援 Linear 和 Trello，比 MCP 節省大量 token。

## 特色功能

- **節省 Token** — 本地 cycle 快取避免重複 API 呼叫，比 MCP 省下大量 token
- **多來源支援** — 支援 Linear 和 Trello
- **智慧任務挑選** — `/work-on next` 自動選擇最高優先級的未指派工作
- **多團隊支援** — 跨多個團隊/看板同步與過濾 issue
- **彈性同步模式** — 選擇 remote（即時同步）或 local（離線優先，稍後用 `--update` 同步）
- **完成模式** — 四種任務完成模式（Linear）：簡單、嚴格審查、上下游嚴格、上下游非嚴格
- **QA 團隊支援** — 完成開發任務時自動將 QA 團隊的 parent issue 更新為「Testing」（Linear）
- **附件下載** — 自動下載圖片和檔案到本地 `.ttt/output/`，供 AI 視覺分析
- **阻塞狀態** — 等待外部依賴時可設定任務為 blocked
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
| `upstream_strict` | 任務標記為 Done，parent 移動到 Testing。若無 parent，fallback 到開發團隊的 testing 狀態。設定 QA 團隊時的預設值。 |
| `upstream_not_strict` | 任務標記為 Done，parent 移動到 Testing。若無 parent 不做 fallback。 |

> **注意**：Trello 因不支援 parent issue，一律使用簡單完成模式。

### 2. 安裝 Claude Code Plugin（選擇性）

```
/plugin marketplace add wayne930242/team-toon-tack
/plugin install team-toon-tack@wayne930242
```

### 3. 每日工作流

在 Claude Code 中（安裝 plugin 後）：

```
/ttt:sync              # 取得當前 cycle 所有 issue/card
/ttt:work-on next      # 挑選最高優先級任務並開始工作
/ttt:done              # 完成任務，附上 AI 生成的摘要
```

或直接使用 CLI：

```bash
ttt sync
ttt work-on next
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

```bash
ttt sync              # 同步 Todo/In Progress 狀態的 issue（較快）
ttt sync --all        # 同步所有狀態的 issue
ttt sync MP-123       # 只同步特定 issue
ttt sync --update     # 將本地狀態推送到遠端（local 模式用）
```

### `ttt work-on`

開始處理任務。

```bash
ttt work-on              # 互動選擇
ttt work-on MP-123       # 指定 issue
ttt work-on next         # 自動選擇最高優先級
```

### `ttt done`

標記任務完成。

```bash
ttt done                         # 若只有一個進行中，自動選擇
ttt done MP-123                  # 指定 issue
ttt done -m "修復了錯誤"           # 附上完成說明
ttt done MP-123 --from-remote    # 從遠端取得（略過本地資料檢查）
```

當 issue 存在於遠端但未同步到本地資料時，使用 `--from-remote`（或 `-r`）。

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
```

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
    ├── cycle.toon      # 當前 cycle 資料（自動產生）
    └── output/         # 下載的附件（圖片、檔案）
```

### 環境變數

| 變數 | 說明 |
|------|------|
| `LINEAR_API_KEY` | **Linear 必填**。你的 Linear API 金鑰 |
| `TRELLO_API_KEY` | **Trello 必填**。你的 Trello API 金鑰 |
| `TRELLO_TOKEN` | **Trello 必填**。你的 Trello 授權 token |
| `TOON_DIR` | 配置目錄（預設：`.ttt`） |

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
/plugin install team-toon-tack@wayne930242
```

### 可用指令

| 指令 | 說明 |
|------|------|
| `/ttt:sync` | 同步 issue 到本地 |
| `/ttt:work-on` | 開始處理任務 |
| `/ttt:done` | 標記當前任務完成 |
| `/ttt:status` | 顯示或修改任務狀態 |
| `/ttt:show` | 顯示 issue 詳情或搜尋 issue |

### 自動啟用技能

Plugin 包含 `linear-task-manager` 技能，在處理任務時會自動啟用，提供工作流程指導和最佳實踐。

## 授權

MIT
