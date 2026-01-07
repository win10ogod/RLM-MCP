# RLM MCP Server v2.4.0

**Recursive Language Model Infrastructure Server** - Enables ANY LLM to process arbitrarily long contexts through recursive decomposition.

English | [中文文档](docs/README_ZH.md)

## 🎯 Key Design Principle

**No external LLM API required!** 

This server provides infrastructure only - your MCP client's LLM performs all the reasoning. This means:
- ✅ Works with any LLM (Claude, GPT, Llama, Gemini, local models, etc.)
- ✅ No API keys needed
- ✅ No additional costs
- ✅ Full control over the reasoning process
- ✅ Cross-platform (Windows, macOS, Linux)

```infographic
infographic compare-binary-horizontal-simple-fold
data
  title RLM Architecture Comparison
  items
    - label Traditional Approach
      desc Server calls external LLM API
      icon mdi:server-network
    - label This Server (v2.0)
      desc Client LLM does all reasoning
      icon mdi:brain
```

## How It Works

The RLM pattern treats long contexts as external data that the LLM interacts with programmatically:

```infographic
infographic sequence-steps-simple
data
  title RLM Processing Flow
  items
    - label 1. Load
      desc Load long context into server
    - label 2. Analyze
      desc Get structure and statistics
    - label 3. Decompose
      desc Split into manageable chunks
    - label 4. Process
      desc LLM reasons over chunks
    - label 5. Aggregate
      desc Combine into final answer
```

Your client's LLM uses the provided tools to:
1. **Load context** - Store arbitrarily long text
2. **Analyze** - Understand structure and size
3. **Decompose** - Split into chunks using various strategies
4. **Search** - Find relevant sections with regex
5. **Execute code** - Manipulate data with JavaScript
6. **Build answer** - Incrementally construct the response

## Installation

```bash
# Clone or navigate to project
cd rlm-mcp-server

# Install dependencies
npm install

# Build
npm run build

# Run
npm start
```

**No environment variables needed!**

## MCP Client Configuration

### Claude Desktop (Windows)

Edit `%APPDATA%\Claude\claude_desktop_config.json`:

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

Edit `~/.config/claude/claude_desktop_config.json`:

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

### Alma

Add to your MCP server configuration:

```json
{
  "rlm-mcp-server": {
    "command": "node",
    "args": ["/path/to/rlm-mcp-server/dist/index.js"]
  }
}
```

## Available Tools

### Context Management

| Tool | Description |
|------|-------------|
| `rlm_load_context` | Load text content into session |
| `rlm_append_context` | Append or prepend content to an existing context |
| `rlm_load_context_from_storage` | Load a persisted context into memory |
| `rlm_get_context_info` | Get metadata and preview |
| `rlm_read_context` | Read portion by chars or lines |
| `rlm_unload_context` | Unload a context from memory (keeps storage copy) |

### Decomposition

| Tool | Description |
|------|-------------|
| `rlm_decompose_context` | Split into chunks (multiple strategies) |
| `rlm_get_chunks` | Retrieve specific chunk contents |
| `rlm_suggest_strategy` | Get recommended chunking strategy |

`rlm_decompose_context` returns a `decompose_id`; pass it to `rlm_get_chunks` or `rlm_rank_chunks` (or use `use_last_decompose`) to reuse options without repeating chunk parameters.
When `decompose_id` is provided, the server uses the context stored in that decomposition record.
When using `use_last_decompose`, the server reuses the latest decomposition for the specified `context_id` (or the most recent decomposition in the session if the context is omitted or missing).

### Search

| Tool | Description |
|------|-------------|
| `rlm_search_context` | Search with regex patterns |
| `rlm_find_all` | Find all substring occurrences |
| `rlm_rank_chunks` | Rank chunks with lexical BM25 scoring |

Search and ranking tools return `cache_hit` for repeated queries within a session.
For CJK text, use `rlm_rank_chunks` with `tokenizer: "cjk_bigrams"` (or keep `tokenizer: "auto"`).
Use `compact: true` or a smaller `context_chars` value in `rlm_search_context` to keep results short.

### Code Execution

| Tool | Description |
|------|-------------|
| `rlm_execute_code` | Run JavaScript in REPL |
| `rlm_set_variable` | Store variable in session |
| `rlm_get_variable` | Retrieve variable |

### Answer Management

| Tool | Description |
|------|-------------|
| `rlm_set_answer` | Set/update answer (partial or final) |
| `rlm_get_answer` | Get current answer state |

### Session & Utilities

| Tool | Description |
|------|-------------|
| `rlm_create_session` | Create isolated session |
| `rlm_get_session_info` | Get session details |
| `rlm_clear_session` | Clear session data |
| `rlm_get_statistics` | Get detailed statistics |

### Tutorial Resources

Tutorials are exposed as MCP resources (use `resources/list` and `resources/read`).

| Resource | Description |
|----------|-------------|
| `rlm://tutorials` | Tutorial index (JSON) |
| `rlm://tutorials/quickstart` | Quickstart overview |
| `rlm://tutorials/quickstart/step/1` | Quickstart step 1 |

## Decomposition Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| `fixed_size` | Fixed character chunks with overlap | General use, JSON |
| `by_lines` | Chunk by number of lines | Code, CSV, logs |
| `by_paragraphs` | Split on double newlines | Articles, documents |
| `by_sections` | Split on markdown headers | Markdown docs |
| `by_regex` | Split on custom pattern | Custom formats |
| `by_sentences` | Split into sentences | Dense text |
| `by_tokens` | Chunk by token count (tiktoken) | Align to model limits |

Note: `by_tokens` requires the `tiktoken` package to be installed.
For `by_sections`, you can use `merge_empty_sections` and `min_section_length` to reduce tiny chunks.

Storage note: persistence defaults to `.rlm_storage` in the server working directory.
Set `RLM_STORAGE_DIR` to override the path, or set it to an empty string to disable persistence.
Chunk metadata is
persisted alongside contexts. Use `RLM_STORAGE_SNAPSHOTS=true` (and
`RLM_STORAGE_MAX_SNAPSHOTS`) to keep historical snapshots.

HTTP note: tune `RLM_HTTP_MAX_CONCURRENT_REQUESTS` and `RLM_HTTP_MAX_BODY_SIZE`
to control backpressure in HTTP mode.

HTTPS note: set `RLM_HTTPS_KEY_PATH` and `RLM_HTTPS_CERT_PATH` (optionally
`RLM_HTTPS_KEY_PASSPHRASE`) and start with `--https` (or set
`RLM_HTTPS_ENABLED=true`) to enable TLS.

Chunk metadata includes `tags` (for example: `["section", "level-2"]`) to
surface structural hints.

## REPL Environment Functions

When using `rlm_execute_code`:

```javascript
// Output
print(...args)                    // Print to output

// Context
getContext(id)                    // Get full content
getContextMetadata(id)            // Get metadata

// String Operations
len(str)                          // Length
slice(str, start, end)            // Substring
split(str, sep)                   // Split to array
join(arr, sep)                    // Join to string
trim(str), lower(str), upper(str) // String transforms

// Regex
search(pattern, text, flags)      // Find matches
findAll(pattern, text)            // All matches with index
replace(text, pattern, repl)      // Replace

// Array
range(start, end, step)           // Generate range
map(arr, fn)                      // Transform
filter(arr, fn)                   // Filter
reduce(arr, fn, init)             // Reduce
sort(arr, fn)                     // Sort (copy)
unique(arr)                       // Remove duplicates
chunk(arr, size)                  // Split array

// Variables
setVar(name, value)               // Store
getVar(name)                      // Retrieve
listVars()                        // List all

// Answer
setAnswer(content, ready)         // Set answer
getAnswer()                       // Get answer state

// JSON
JSON.parse(str)                   // Parse
JSON.stringify(obj, indent)       // Stringify
```

## Example Workflow

Here's how an LLM might process a very long document:

```
1. Load the document:
   rlm_load_context(context="...", context_id="doc")

2. Analyze structure:
   rlm_get_context_info(context_id="doc")
   → Returns: 500,000 chars, markdown, 12,000 lines

3. Get strategy suggestion:
   rlm_suggest_strategy(context_id="doc")
   → Returns: by_sections (markdown content)

4. Decompose:
   rlm_decompose_context(context_id="doc", strategy="by_sections")
   → Returns: 45 chunks (sections)

5. Search for relevant sections:
   rlm_search_context(context_id="doc", pattern="climate change")
   → Returns: Matches in chunks 3, 7, 12, 23

6. Get those chunks:
   rlm_get_chunks(chunk_indices=[3, 7, 12, 23])
   → Returns: Content of those sections

7. Process each chunk (LLM reasoning)
   Build understanding from each section...

8. Save intermediate results:
   rlm_set_variable(name="findings", value=[...])

9. Aggregate into final answer:
   rlm_set_answer(content="Based on analysis...", ready=true)
```

## Use Cases

### Long Document Analysis
- Research paper summarization
- Legal document review
- Code repository understanding

### Multi-Document Processing
- Literature review
- Comparative analysis
- Information aggregation

### Log Analysis
- Error pattern detection
- Timeline reconstruction
- Anomaly identification

### Data Extraction
- Entity extraction from large texts
- Pattern mining
- Content classification

## Roadmap and Evaluation

- Roadmap: `docs/ROADMAP.md`
- Evaluation plan: `docs/EVALUATION.md`

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     MCP Client                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │                Your LLM                          │   │
│  │  (Claude, GPT, Llama, Gemini, etc.)             │   │
│  │                                                  │   │
│  │  Performs all reasoning and recursive calls     │   │
│  └─────────────────────────────────────────────────┘   │
│                         │                               │
│                    MCP Protocol                         │
│                         │                               │
└─────────────────────────┼───────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────┐
│              RLM MCP Server (this)                      │
│                         │                               │
│  ┌──────────────────────┴──────────────────────────┐   │
│  │              Tools Layer                         │   │
│  │  load, read, decompose, search, execute, etc.   │   │
│  └─────────────────────────────────────────────────┘   │
│                         │                               │
│  ┌──────────────────────┴──────────────────────────┐   │
│  │            Services Layer                        │   │
│  │  ┌─────────────┐  ┌────────────────────────┐   │   │
│  │  │  Session    │  │  Context Processor     │   │   │
│  │  │  Manager    │  │  (decompose, search)   │   │   │
│  │  └─────────────┘  └────────────────────────┘   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  No external dependencies - pure JavaScript             │
└─────────────────────────────────────────────────────────┘
```

## Running Modes

### Stdio (Default)
For MCP clients like Claude Desktop:
```bash
node dist/index.js
```

### Serve (Auto HTTP/HTTPS)
For quick local testing without extra flags:
```bash
node dist/index.js --serve --port=3000
```
Uses HTTPS when `RLM_HTTPS_KEY_PATH` and `RLM_HTTPS_CERT_PATH` are available,
otherwise falls back to HTTP.
If you place dev certs at `certs/localhost.key` and `certs/localhost.crt`, they are auto-detected.

### All (Stdio + HTTP/HTTPS)
Run both transports together:
```bash
node dist/index.js --all --port=3000
```
Or:
```bash
npm run all
```

If the chosen port is in use, `--all` will try the next available port automatically.

### HTTP
For remote access or testing:
```bash
node dist/index.js --http --port=3000
```

Endpoints:
- `POST /mcp` - MCP protocol
- `GET /health` - Health check
- `GET /info` - Server info

## HTTP Authentication (OAuth2)

Set `RLM_OAUTH_ENABLED=true` to protect the HTTP `/mcp` endpoint with OAuth2
client credentials. The server exposes:
- `/.well-known/oauth-protected-resource` (protected resource metadata)
- `/.well-known/oauth-protected-resource/mcp` (MCP resource metadata)
- `/.well-known/oauth-authorization-server`
- `/oauth/token`
- `/oauth/jwks` (for RS256)

Clients can discover `resource_metadata` in the `WWW-Authenticate` header or fetch it directly from the well-known endpoints.

Example token request:
```bash
curl -X POST http://localhost:3000/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=rlm-client&client_secret=rlm-secret&scope=mcp"
```

Use the returned token:
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Why This Design?

The original RLM paper describes a system where the LLM calls sub-LLMs recursively. However, in the MCP context:

1. **The client already has an LLM** - No need for another API
2. **Cost efficiency** - No additional API calls/costs
3. **Flexibility** - Works with any LLM
4. **Control** - The client controls the reasoning
5. **Simplicity** - Pure infrastructure, no API keys

The tools in this server provide everything needed for the LLM to implement RLM patterns itself.

## Contributing

Contributions welcome! Areas of interest:
- Additional decomposition strategies
- Performance optimizations
- New REPL helper functions
- Documentation improvements

## License

MIT License

## References

- [Recursive Language Models Paper](https://arxiv.org/abs/2512.24601)
- [RLM Blog Post](https://alexzhang13.github.io/blog/2025/rlm/)
- [MCP Protocol](https://modelcontextprotocol.io/)

---

Built for the long-context AI community 🚀
