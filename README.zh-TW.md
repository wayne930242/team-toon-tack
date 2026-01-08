# team-toon-tack (ttt)

繁體中文 | [English](./README.md)

為 Claude Code 最佳化的 Linear 工作流 — 比 MCP 節省大量 token。

## 特色功能

- **節省 Token** — 本地 cycle 快取避免重複 API 呼叫，比 Linear MCP 省下大量 token
- **智慧任務挑選** — `/work-on next` 自動選擇最高優先級的未指派工作
- **多團隊支援** — 跨多個團隊同步與過濾 issue
- **彈性同步模式** — 選擇 remote（即時同步 Linear）或 local（離線優先，稍後用 `--update` 同步）
- **QA/PM 團隊支援** — 完成開發任務時自動將 QA/PM 團隊的 parent issue 更新為「Testing」
- **自動安裝指令** — `ttt init` 可自動安裝 Claude Code commands，支援自訂前綴
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
- **狀態來源**：`remote`（即時更新 Linear）或 `local`（離線工作，用 `ttt sync --update` 同步）
- **QA/PM 團隊**：跨團隊 parent issue 更新（需在 Linear 設定 parent）
- **Claude Code commands**：自動安裝，可選前綴（如 `/ttt:work-on`）

### 2. 每日工作流

在 Claude Code 中：

```
/sync              # 從 Linear 取得當前 cycle 所有 issue
/work-on next      # 挑選最高優先級任務並開始工作
/done-job          # 完成任務，附上 AI 生成的摘要
```

就這樣。

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
    └── cycle.toon      # 當前 cycle 資料（自動產生）
```

### 環境變數

| 變數 | 說明 |
|------|------|
| `LINEAR_API_KEY` | **必填**。你的 Linear API 金鑰 |
| `TOON_DIR` | 配置目錄（預設：`.ttt`） |

## 授權

MIT
