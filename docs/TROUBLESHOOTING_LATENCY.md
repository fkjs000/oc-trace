# OpenClaw 延遲故障排除指南

本文件旨在指導如何根據 `oc-trace` 的追蹤結果，針對性地解決 OpenClaw 系統的延遲問題。

## 場景 A：隊列等待 (WaitMs) 異常過高
**現象**：`⏱️ 隊列等待` 長期超過 500ms 以上。
*   **根本原因**：
    1.  訊息湧入速度大於 Agent 處理速度。
    2.  系統配置的並發限制 (Concurrency) 過低。
*   **排查與解決**：
    *   檢查 `config.toml` 中的 `concurrency` 或 `max_agents` 設定。
    *   增加伺服器核心數以支持更多併發實例。

## 場景 B：前置處理 (HookMs) 緩慢
**現象**：`🧪 前置處理` 超過 1000ms。
*   **根本原因**：
    1.  掛載了過多或低效的 Pre-run Hooks。
    2.  Hook 中執行了同步的檔案 IO 或外部網路請求。
*   **排查與解決**：
    *   檢查自定義插件代碼，將耗時操作改為非同步執行。
    *   評估是否有不必要的插件被啟用。

## 場景 C：記憶檢索 (MemoryMs) 緩慢
**現象**：`🔍 記憶檢索` 超過 2000ms。
*   **根本原因**：
    1.  向量資料庫 (LanceDB) 檔案過大（如超過 1GB）且未建立索引。
    2.  Embedding 模型在本地 CPU 上的計算速度太慢。
*   **排查與解決**：
    *   定期執行資料庫壓縮與索引維護。
    *   考慮減少檢索的 `top_k` 數量或優化向量維度。

## 場景 D：模型推理 (InferenceMs) 波動大
**現象**：同樣的模型，耗時從 3s 突然跳到 60s。
*   **根本原因**：
    1.  LLM 供應商 (OpenAI/Anthropic/DeepSeek) 服務不穩定。
    2.  請求觸發了 Rate Limit 被供應商掛起。
*   **排查與解決**：
    *   使用 `oc-trace --watch` 觀察是否特定模型發生此現象。
    *   配置負載平衡或多個 API Key 輪詢。

## 場景 E：傳送回傳 (DeliveryMs) 延遲
**現象**：`🚀 傳送回傳` 數值很大，但 `🤖 模型推理` 很快。
*   **根本原因**：
    1.  伺服器到 Telegram API 的網絡路由不佳。
    2.  Webhook 解析或回傳管道發生阻塞。
*   **排查與解決**：
    *   測試 `curl https://api.telegram.org` 的響應時間。
    *   如果使用代理，檢查代理伺服器的負載與延遲。

---
*文件路徑：/home/frankjonas/.openclaw/docs/TROUBLESHOOTING_LATENCY.md*
