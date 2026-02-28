# oc-trace

OpenClaw 專用的效能追蹤與實時監控工具 (Performance Tracing & Real-time Monitoring Tool)。

## 1. 簡介
`oc-trace` 是一個輕量級的 CLI 工具，專為追蹤 OpenClaw 訊息處理的完整生命週期而設計。它能將分散的非同步日誌串聯，提供毫秒級的各階段耗時分析。

## 2. 安裝方式
您可以透過 Git 直接安裝為全域指令：
```bash
npm install -g git+https://github.com/fkjs000/oc-trace.git
```

## 3. 快速開始
安裝完成後，在終端機輸入：
```bash
# 實時監控模式 (推薦開發調試使用)
oc-trace --watch

# 查看今日全量掃描
oc-trace

# 查看最近 10 筆效能報告
oc-trace --limit 10

# 查看過去 30 分鐘內的效能統計
oc-trace --since 30m
```

## 4. 指標解讀
| 指標名稱 | 意義 | 理想值 |
| :--- | :--- | :--- |
| **⏱️ 隊列等待** | 系統繁忙度 (Queue Wait) | < 100ms |
| **🧪 前置處理** | Hooks 與中間件執行效率 | < 500ms |
| **🔍 記憶檢索** | 向量資料庫 (LanceDB) 檢索速度 | 500-1500ms |
| **🤖 模型推理** | AI 模型響應耗時 (LLM Inference) | 2s - 30s |
| **🚀 傳送回傳** | 渠道發送延遲 (Delivery) | < 1s |

## 5. 高階參數
*   `--log-dir <path>`: 指定 OpenClaw 日誌目錄（預設：`/tmp/openclaw`）。
*   `--since <n>[m|h]`: 過濾特定時間範圍內的日誌。
*   `--watch`: 開啟實時監控模式，支援跨午夜日誌自動滾動。

## 6. 技術文件
更多詳細資訊請參考：
*   [效能指南 (PERFORMANCE_GUIDE.md)](https://github.com/fkjs000/oc-trace/blob/main/docs/PERFORMANCE_GUIDE.md)
*   [故障排除 (TROUBLESHOOTING_LATENCY.md)](https://github.com/fkjs000/oc-trace/blob/main/docs/TROUBLESHOOTING_LATENCY.md)

---
*License: MIT*
