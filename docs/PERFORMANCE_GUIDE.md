# OpenClaw 效能追蹤工具 (oc-trace) 技術文件

`oc-trace` 是一個輕量級的 Node.js 腳本，專為追蹤 OpenClaw 訊息處理的完整生命週期而設計。它通過解析 `/tmp/openclaw/` 下的 JSON 日誌，將分散的非同步日誌串聯為直觀的效能指標。

## 1. 核心功能
*   **多階段追蹤**：涵蓋從訊息進入隊列 (Enqueue) 到 Telegram 成功送達 (Delivery) 的全流程。
*   **實時監控 (Watch Mode)**：使用 `--watch` 參數，即時查看每一條訊息的處理進度。
*   **彈性過濾**：
    *   `--limit <n>`：查看最近 n 筆完成的任務。
    *   `--since <n>[m|h]`：查看最近 n 分鐘或 n 小時內的數據（例如 `--since 30m`）。
*   **日誌滾動支援**：長期執行 `watch` 模式時，會自動切換至隔日產生的新日誌檔案。
*   **穩定性機制**：內建 Partial Line 緩衝區，確保日誌檔案在高頻寫入時不會因 JSON 截斷而遺失數據。

## 2. 指令說明
```bash
# 基本用法：全量掃描今日日誌
oc-trace

# 實時監控模式 (推薦開發調試使用)
oc-trace --watch

# 查看過去一小時內的效能統計
oc-trace --since 1h

# 僅顯示最近 5 筆紀錄
oc-trace --limit 5
```

## 3. 關鍵效能指標解讀

| 指標名稱 | 追蹤點 (Log Event) | 理想值 | 過高原因與排查方向 |
| :--- | :--- | :--- | :--- |
| **隊列等待** | `lane enqueue` -> `lane dequeue` | < 100ms | 系統併發過高，Agent 資源池已滿。 |
| **前置處理** | `dequeue` -> `memory injecting` | < 500ms | 執行 Pre-run Hooks 與 Middleware 的時間。 |
| **記憶檢索** | `memory injecting` -> `run start` | 500-1500ms | 向量資料庫 (LanceDB) 檢索與 Embedding 計算時間。 |
| **模型推理** | `run start` -> `run prompt end` | 2s - 30s | LLM Provider 回應延遲。請確認 API 狀態或模型選擇。 |
| **傳送回傳** | `inference end` -> `sendMessage ok` | < 1s | 網絡瓶頸。檢查伺服器與 Telegram API 之間的連線。 |

## 4. 運作原理
1.  **日誌路徑**：預設讀取 `/tmp/openclaw/openclaw-YYYY-MM-DD.log`。
2.  **狀態機追蹤**：使用 `activeLanes` Map 結構，以 `sid (laneId)` 為 Key，跟蹤未完成的請求。當匹配到 `sendMessage ok` 時，計算總耗時並移出活躍池。
3.  **流式讀取**：初始掃描使用 `readline` 接口與 `fs.createReadStream`，確保在大體積日誌下保持低記憶體消耗。

---
*最後更新日期：2026-02-28*
*工具位置：/home/frankjonas/oc-trace.js*
