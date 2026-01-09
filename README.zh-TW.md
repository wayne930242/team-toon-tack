# team-toon-tack (ttt)

繁體中文 | [English](./README.md)

為 Claude Code 最佳化的 Linear 工作流 — 比 MCP 節省大量 token。

## 特色功能

- **節省 Token** — 本地 cycle 快取避免重複 API 呼叫，比 Linear MCP 省下大量 token
- **智慧任務挑選** — `/work-on next` 自動選擇最高優先級的未指派工作
- **多團隊支援** — 跨多個團隊同步與過濾 issue
- **彈性同步模式** — 選擇 remote（即時同步 Linear）或 local（離線優先，稍後用 `--update` 同步）
- **完成模式** — 四種任務完成模式：簡單、嚴格審查、上下游嚴格、上下游非嚴格
- **QA 團隊支援** — 完成開發任務時自動將 QA 團隊的 parent issue 更新為「Testing」
- **附件下載** — 自動下載 Linear 圖片和檔案到本地 `.ttt/output/`，供 AI 視覺分析
- **阻塞狀態** — 等待外部依賴時可設定任務為 blocked
- **Claude Code Plugin** — 安裝 plugin 即可使用 `/ttt:*` 指令和自動啟用的技能
- **Cycle 歷史保存** — 本地 `.toon` 檔案保留 cycle 資料，方便 AI 檢閱
- **使用者過濾** — 只顯示指派給你或未指派的工作

## 快速開始

### 1. 安裝與初始化

```bash
npm install -g team-toon-tack
export LINEAR_API_KEY="lin_api_xxxxx"

cd your-project
ttt init
```

初始化時會設定：
- **開發團隊**：你的開發團隊（單選）
- **開發團隊測試狀態**：開發團隊的 testing/review 狀態（可選）
- **QA 團隊**：跨團隊 parent issue 更新，各自設定 testing 狀態（可選）
- **完成模式**：任務完成時的處理方式（見下方說明）
- **狀態來源**：`remote`（即時更新 Linear）或 `local`（離線工作，用 `ttt sync --update` 同步）

### 完成模式

| 模式 | 行為 |
|------|------|
| `simple` | 任務標記為 Done，parent 也標記為 Done。未設定 QA 團隊時的預設值。 |
| `strict_review` | 任務標記到開發團隊的 testing 狀態，parent 標記到 QA 團隊的 testing 狀態。 |
| `upstream_strict` | 任務標記為 Done，parent 移動到 Testing。若無 parent，fallback 到開發團隊的 testing 狀態。設定 QA 團隊時的預設值。 |
| `upstream_not_strict` | 任務標記為 Done，parent 移動到 Testing。若無 parent 不做 fallback。 |

### 2. 安裝 Claude Code Plugin（選擇性）

```
/plugin marketplace add wayne930242/team-toon-tack
/plugin install team-toon-tack@wayne930242
```

### 3. 每日工作流

在 Claude Code 中（安裝 plugin 後）：

```
/ttt:sync              # 從 Linear 取得當前 cycle 所有 issue
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
ttt init                           # 互動模式
ttt init --user alice@example.com  # 預選使用者
ttt init --label Frontend          # 設定預設標籤
ttt init --force                   # 覆蓋現有配置
```

### `ttt sync`

從 Linear 同步當前 cycle 的 issue。

```bash
ttt sync              # 同步所有符合條件的 issue
ttt sync MP-123       # 只同步特定 issue
ttt sync --update     # 將本地狀態推送到 Linear（local 模式用）
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
ttt done                    # 若只有一個進行中，自動選擇
ttt done MP-123             # 指定 issue
ttt done -m "修復了錯誤"      # 附上完成說明
```

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
ttt show MP-123 --remote       # 從 Linear 取得特定 issue
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
| `LINEAR_API_KEY` | **必填**。你的 Linear API 金鑰 |
| `TOON_DIR` | 配置目錄（預設：`.ttt`） |

## Claude Code Plugin

安裝 plugin 以整合 Claude Code：

```
/plugin marketplace add wayne930242/team-toon-tack
/plugin install team-toon-tack@wayne930242
```

### 可用指令

| 指令 | 說明 |
|------|------|
| `/ttt:sync` | 同步 Linear issue 到本地 |
| `/ttt:work-on` | 開始處理任務 |
| `/ttt:done` | 標記當前任務完成 |
| `/ttt:status` | 顯示或修改任務狀態 |
| `/ttt:show` | 顯示 issue 詳情或搜尋 issue |

### 自動啟用技能

Plugin 包含 `linear-task-manager` 技能，在處理 Linear 任務時會自動啟用，提供工作流程指導和最佳實踐。

## 授權

MIT
