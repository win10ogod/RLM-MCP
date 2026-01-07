# RLM MCP Server 中文指南

**Recursive Language Model Infrastructure Server** - 讓任意 LLM 透過遞迴式分解處理超長上下文。

這個伺服器只提供基礎設施，推理由 MCP 客戶端中的 LLM 完成，**不需要外部 LLM API**。

## 特色重點

- 支援任意 LLM（Claude / GPT / Llama / Gemini / 本地模型）
- 無需 API Key，零額外成本
- 工具齊全：載入、分割、搜尋、排名、執行程式碼
- 跨平台（Windows / macOS / Linux）

## 快速開始

```bash
cd rlm-mcp-server
npm install
npm run build
npm start
```

## 一鍵啟動（HTTP/HTTPS 自動）

```bash
npm run serve
```

也可以直接使用：

```bash
node dist/index.js --serve --port=3000
```

若已設定 `RLM_HTTPS_KEY_PATH` / `RLM_HTTPS_CERT_PATH`，會自動使用 HTTPS，
否則回退為 HTTP。放在 `certs/localhost.key` 和 `certs/localhost.crt` 也會被自動偵測。

## 同時啟動（Stdio + HTTP/HTTPS）

```bash
node dist/index.js --all --port=3000
```
或使用：

```bash
npm run all
```

若指定的埠被占用，`--all` 會自動嘗試下一個可用埠。

## MCP 客戶端設定

### Claude Desktop (Windows)

編輯 `%APPDATA%\Claude\claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "rlm": {
      "command": "node",
      "args": ["C:\\path\\to\\rlm-mcp-server\\dist\\index.js"]
    }
  }
}
```

### Claude Desktop (macOS/Linux)

編輯 `~/.config/claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "rlm": {
      "command": "node",
      "args": ["/path/to/rlm-mcp-server/dist/index.js"]
    }
  }
}
```

## 常用工作流程

1. `rlm_load_context` 載入長文
2. `rlm_get_context_info` / `rlm_get_statistics` 分析結構
3. `rlm_suggest_strategy` 取得分割建議
4. `rlm_decompose_context` 分割並取得 `decompose_id`
5. `rlm_get_chunks` / `rlm_rank_chunks` 取回重點片段
6. `rlm_set_answer` 累積產出

## decompose_id 與 use_last_decompose

`rlm_decompose_context` 會回傳 `decompose_id`，可直接用於後續查詢，避免重複傳遞分割參數：

```json
{
  "decompose_id": "decompose_1736520000000_ab12cd",
  "query": "關鍵結論",
  "top_k": 5
}
```

提供 `decompose_id` 時，會自動使用對應的 `context_id`。

`use_last_decompose: true` 會使用同一個 session 中最近一次的分割設定：
- 若指定 `context_id` 且該 context 存在，則使用該 context 的最新分割
- 若未指定或該 context 不存在，則使用 session 中最近的分割紀錄

建議在多 context 情境下明確傳入 `context_id`，避免混淆。

## 搜尋輸出精簡

`rlm_search_context` 支援 `compact: true`，可移除周邊上下文片段以縮短回傳：

```json
{
  "context_id": "doc",
  "pattern": "錯誤|警告",
  "compact": true,
  "max_results": 20
}
```

也可以調小 `context_chars` 取得更短的上下文片段。

## HTTP OAuth2

設定 `RLM_OAUTH_ENABLED=true` 後，`/mcp` 需要 Bearer token：

伺服器會提供：
- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-authorization-server`
- `/oauth/token`
- `/oauth/jwks`（RS256）

MCP 客戶端也可從 `WWW-Authenticate` 標頭取得 `resource_metadata`。

```bash
curl -X POST http://localhost:3000/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=rlm-client&client_secret=rlm-secret&scope=mcp"
```

取得 token 後呼叫：

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 更多文件

- 範例流程：`docs/EXAMPLES.md`
- 設定說明：`docs/CONFIGURATION.md`
- 路線圖：`docs/ROADMAP.md`
- 評估計畫：`docs/EVALUATION.md`
- 測試回饋（中文）：`docs/TEST_REPORT_ZH.md`
