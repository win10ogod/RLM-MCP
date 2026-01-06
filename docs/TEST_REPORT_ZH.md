# RLM-MCP-Server 測試報告（中文）

本文件整理測試結果、已修正問題與後續優化建議，供產品與文件規劃參考。

## 測試結果總覽

| 功能 | 狀態 | 備註 |
| --- | --- | --- |
| 建立 Session | ✅ 正常 | |
| 載入 Context | ✅ 正常 | 自動偵測 Markdown 結構 |
| 取得 Context 資訊 | ✅ 正常 | |
| 策略建議 | ✅ 正常 | |
| 統計資訊 | ✅ 正常 | |
| 按章節分割 | ✅ 正常 | 支援多層級標題 |
| 正則搜尋 | ✅ 正常 | |
| 子字串搜尋 | ✅ 正常 | |
| BM25 排名 | ✅ 正常 | 中文支援良好 |
| 程式碼執行 | ✅ 正常 | |
| 變數存取 | ✅ 正常 | |
| 讀取部分內容 | ✅ 正常 | |
| 追加內容 | ✅ 正常 | |
| Answer 管理 | ✅ 正常 | |
| use_last_decompose | ✅ 已修正 | 會正確保存並回用 context_id |

## 已修正問題

- use_last_decompose：現在會正確沿用前一次分割的 context_id，不再出現 `Context "main" not found`。
- rlm_rank_chunks：新增 `decompose_id` / `use_last_decompose` 支援，減少重複參數。
- rlm_search_context：新增 `compact: true`，可縮短搜尋輸出。

## 優化建議

```infographic
infographic list-grid-badge-card
data
  title RLM-MCP-Server 優化建議
  items
    - label 1. decompose_id 問題
      desc use_last_decompose 已可保存 context_id，建議文件強調用法
      icon mdi:check
    - label 2. 參數過多
      desc rlm_get_chunks / rlm_rank_chunks 使用 decompose_id 可減少重複參數
      icon mdi:format-list-bulleted
    - label 3. 缺少批次操作
      desc 無法一次載入多個 context，需逐一呼叫
      icon mdi:package-variant
    - label 4. 搜尋結果過長
      desc 新增 compact 模式，仍可優化預設輸出策略
      icon mdi:text-box-search
```

## 詳細問題與建議

### Bug：use_last_decompose 不完整（已修正）

**問題**：使用 `use_last_decompose: true` 時，沒有自動帶入之前的 context_id，導致錯誤：

```
Context "main" not found
```

**修正**：decompose 設定會回傳並沿用 `context_id`，並在 session 中正確取用。

## API 設計優化建議

```infographic
infographic sequence-snake-steps-simple
data
  title 建議的簡化工作流程
  items
    - label 載入
      desc load_context
    - label 分割
      desc decompose → 返回 decompose_id
    - label 查詢
      desc 用 decompose_id 直接查詢
    - label 結果
      desc 不需重複參數
```

目前痛點：

- `rlm_get_chunks` 即使有 `decompose_id`，文件仍需強調可省略重複參數
- `rlm_rank_chunks` 以往未支援 `decompose_id`（已補齊）
- 參數太多且重複，每個工具都需要傳遞相同的分割選項

建議：

```javascript
// 理想的 API
const { decompose_id } = await rlm_decompose_context({ context_id, strategy: 'by_sections' });

// 後續操作只需 decompose_id
await rlm_get_chunks({ decompose_id, chunk_indices: [0, 1, 2] });
await rlm_rank_chunks({ decompose_id, query: '搜尋' });
```

## 功能增強建議

| 建議 | 說明 | 優先級 |
| --- | --- | --- |
| 批次載入 | 一次載入多個文件到不同 context | 中 |
| Streaming 進度回報 | 大文件分段載入時的進度回報 | 中 |
| 預設 context_id | 自動推斷或集中管理 | 中 |
| 搜尋結果精簡 | 進一步提供 compact/summary 模式 | 中 |
| 匯出匯入 | 保存整個 session 狀態 | 中 |

## 使用上遇到的困難

```infographic
infographic list-column-done-list
data
  title 使用困難點
  items
    - label 工具數量多
      desc 22 個工具，初學者難以選擇正確的工具
    - label 參數重複
      desc 分割參數需要在多個工具間重複傳遞
    - label context_id 管理
      desc 多 context 時需要手動追蹤 ID
    - label 錯誤訊息
      desc 部分錯誤訊息不夠明確
```

## 總結

RLM-MCP-Server 是一個功能強大的長文本處理工具，特別適合：

- RAG 應用的文本分割
- 大型文檔的語義搜尋
- 結構化文本（Markdown、JSON）的處理

主要優點：

- ✅ 豐富的分割策略
- ✅ BM25 排名搜尋
- ✅ JavaScript REPL 支援
- ✅ 快取機制提升效能

仍可改進的方向：

- ⚠️ 簡化 API，減少重複參數
- ⚠️ 提供更高階的封裝函數
