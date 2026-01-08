# team-toon-tack (ttt)

繁體中文 | [English](./README.md)

使用 TOON 格式同步與管理 Linear 任務的 CLI 工具。

## 安裝

```bash
# npm（推薦）
npm install -g team-toon-tack

# 或用 bun
bun add -g team-toon-tack

# 或用 npx/bunx 免安裝執行
npx team-toon-tack <command>
bunx team-toon-tack <command>

# 全域安裝後可用簡寫
ttt <command>
```

## 快速開始

```bash
# 1. 設定 Linear API 金鑰
export LINEAR_API_KEY="lin_api_xxxxx"

# 2. 在專案中初始化
cd your-project
ttt init

# 3. 從 Linear 同步任務
ttt sync

# 4. 開始工作
ttt work-on
```

## 指令

### `ttt init`

在當前目錄初始化配置檔。

```bash
ttt init                           # 互動模式
ttt init --user alice@example.com  # 預選使用者
ttt init --label Frontend          # 設定預設標籤
ttt init --force                   # 覆蓋現有配置
ttt init -y                        # 非互動模式
```

### `ttt sync`

從 Linear 同步當前 cycle 的任務。

```bash
ttt sync
```

### `ttt work-on`

開始處理任務。

```bash
ttt work-on              # 互動選擇
ttt work-on MP-123       # 指定任務
ttt work-on next         # 自動選擇最高優先級
```

### `ttt done`

標記任務完成。

```bash
ttt done                    # 自動選擇（僅一個進行中時）
ttt done MP-123             # 指定任務
ttt done -m "修復了問題"     # 附帶完成說明
```

## 配置

### 目錄結構

執行 `ttt init` 後，專案會有：

```
your-project/
├── config.toon    # 團隊配置（建議 gitignore）
├── local.toon     # 個人設定（gitignore）
└── cycle.toon     # 當前 cycle 資料（gitignore，自動產生）
```

### 自訂配置目錄

```bash
# 用 -d 參數
ttt sync -d ./team

# 或設定環境變數
export TOON_DIR=./team
ttt sync
```

### config.toon

團隊配置（從 Linear 抓取）：

```toon
teams:
  main:
    id: TEAM_UUID
    name: Team Name

users:
  alice:
    id: USER_UUID
    email: alice@example.com
    displayName: Alice

labels:
  frontend:
    id: LABEL_UUID
    name: Frontend

current_cycle:
  id: CYCLE_UUID
  name: Cycle #1
```

### local.toon

個人設定：

```toon
current_user: alice
label: Frontend
exclude_assignees[1]: bob
```

| 欄位 | 說明 |
|------|------|
| `current_user` | 你在 config.toon 中的 user key |
| `label` | 依標籤過濾任務（選填） |
| `exclude_assignees` | 隱藏這些使用者的任務（選填） |

## 環境變數

| 變數 | 說明 |
|------|------|
| `LINEAR_API_KEY` | **必填**。你的 Linear API 金鑰 |
| `TOON_DIR` | 配置目錄（預設：當前目錄） |

## 整合範例

### 搭配 Claude Code

```yaml
# .claude/commands/sync.md
---
description: 同步 Linear 任務
---
ttt sync -d .toon
```

### 作為 Git 子模組

```bash
# 將配置目錄加為子模組
git submodule add https://github.com/your-org/team-config.git team
cd team && ttt sync
```

### 在 package.json 中

```json
{
  "scripts": {
    "sync": "ttt sync -d .toon",
    "work": "ttt work-on -d .toon"
  }
}
```

## 授權

MIT
