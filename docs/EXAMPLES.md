# RLM MCP Server - Usage Examples

## Basic Workflow

### Example 1: Process a Long Document

```
User: "Summarize this 200-page research paper for me"

LLM's approach using RLM tools:
```

**Step 1: Load the context**
```json
Tool: rlm_load_context
{
  "context": "... 500,000 characters of research paper ...",
  "context_id": "paper"
}
```

**Optional: Stream additional chunks**
```json
Tool: rlm_append_context
{
  "context_id": "paper",
  "content": "... next 100,000 characters ...",
  "mode": "append"
}
```

**Step 2: Analyze structure**
```json
Tool: rlm_get_context_info
{
  "context_id": "paper",
  "preview_length": 3000
}
```
Response:
```json
{
  "context_id": "paper",
  "metadata": {
    "length": 524288,
    "lineCount": 12450,
    "wordCount": 87234,
    "structure": "markdown"
  },
  "preview": "# Research Paper Title\n\n## Abstract\n..."
}
```

**Step 3: Get decomposition suggestion**
```json
Tool: rlm_suggest_strategy
{
  "context_id": "paper"
}
```
Response:
```json
{
  "context_id": "paper",
  "structure": "markdown",
  "strategy": "by_sections",
  "reason": "Markdown content has natural section boundaries",
  "options": {}
}
```

**Step 4: Decompose into sections**
```json
Tool: rlm_decompose_context
{
  "context_id": "paper",
  "strategy": "by_sections",
  "return_content": false
}
```

**Optional: Merge tiny or empty sections**
```json
Tool: rlm_decompose_context
{
  "context_id": "paper",
  "strategy": "by_sections",
  "merge_empty_sections": true,
  "min_section_length": 200
}
```

**Alternative: Token-based chunking**
```json
Tool: rlm_decompose_context
{
  "context_id": "paper",
  "strategy": "by_tokens",
  "tokens_per_chunk": 2000,
  "token_overlap": 200,
  "model": "gpt-4o-mini"
}
```
Response:
```json
{
  "decompose_id": "decompose_1736520000000_ab12cd",
  "total_chunks": 45,
  "strategy": "by_sections",
  "chunks": [
    { "index": 0, "start_offset": 0, "end_offset": 1234, "length": 1234, "level": 1, "title": "Abstract" },
    { "index": 1, "start_offset": 1234, "end_offset": 5678, "length": 4444, "level": 1, "title": "Introduction" },
    ...
  ]
}
```
You can reuse `decompose_id` with `rlm_get_chunks` or `rlm_rank_chunks` to avoid repeating chunking parameters.

**Step 5: Get key sections**
```json
Tool: rlm_get_chunks
{
  "context_id": "paper",
  "chunk_indices": [0, 1, 44],  // Abstract, Introduction, Conclusion
  "decompose_id": "decompose_1736520000000_ab12cd"
}
```
You can also set `"use_last_decompose": true` to reuse the most recent decomposition for a context.

**Step 6: Search for key terms**
```json
Tool: rlm_search_context
{
  "context_id": "paper",
  "pattern": "conclusion|finding|result|significant",
  "max_results": 20
}
```

**Alternative: Rank chunks with BM25**
```json
Tool: rlm_rank_chunks
{
  "decompose_id": "decompose_1736520000000_ab12cd",
  "query": "key findings and conclusions",
  "top_k": 5
}
```

For CJK text, set `tokenizer` to `cjk_bigrams`:
```json
Tool: rlm_rank_chunks
{
  "context_id": "paper",
  "query": "搜尋功能如何使用",
  "strategy": "by_sections",
  "top_k": 5,
  "tokenizer": "cjk_bigrams"
}
```

**Step 7: Build answer incrementally**
```json
Tool: rlm_set_answer
{
  "content": "## Summary of Research Paper\n\n### Main Findings:\n1. ...",
  "ready": false
}
```

**Step 8: Finalize answer**
```json
Tool: rlm_set_answer
{
  "content": "## Complete Summary\n\n[Full summary here]",
  "ready": true
}
```

---

### Example 2: Log File Analysis

```
User: "Find all errors in this server log and categorize them"
```

**Step 1: Load log file**
```json
Tool: rlm_load_context
{
  "context": "2024-01-15 10:00:01 INFO Starting server...\n2024-01-15 10:00:02 ERROR Database connection failed...\n...",
  "context_id": "logs"
}
```

**Step 2: Get statistics**
```json
Tool: rlm_get_statistics
{
  "context_id": "logs"
}
```
Response:
```json
{
  "context_id": "logs",
  "length": 2500000,
  "lineCount": 50000,
  "wordCount": 350000,
  "sentenceCount": 45000,
  "paragraphCount": 1,
  "avgLineLength": 50
}
```

**Step 3: Search for errors**
```json
Tool: rlm_search_context
{
  "context_id": "logs",
  "pattern": "ERROR|FATAL|CRITICAL",
  "context_chars": 200,
  "max_results": 200
}
```

**Step 4: Categorize with code**
```json
Tool: rlm_execute_code
{
  "code": "const ctx = getContext('logs');\nconst errors = search('ERROR.*', ctx);\nconst categories = {};\nerrors.forEach(e => {\n  const type = e.includes('Database') ? 'db' : e.includes('Network') ? 'network' : 'other';\n  categories[type] = (categories[type] || 0) + 1;\n});\nprint(JSON.stringify(categories, null, 2));\nsetVar('errorCategories', categories);"
}
```

**Step 5: Get stored results**
```json
Tool: rlm_get_variable
{
  "name": "errorCategories"
}
```

---

### Example 3: Code Repository Analysis

```
User: "Find all TODO comments in this codebase and explain what needs to be done"
```

**Step 1: Load codebase**
```json
Tool: rlm_load_context
{
  "context": "... entire codebase concatenated ...",
  "context_id": "code"
}
```

**Step 2: Search for TODOs**
```json
Tool: rlm_search_context
{
  "context_id": "code",
  "pattern": "TODO:?\\s*(.+)",
  "context_chars": 300,
  "max_results": 100
}
```
Response:
```json
{
  "pattern": "TODO:?\\s*(.+)",
  "total_matches": 47,
  "matches": [
    {
      "match": "TODO: Implement caching",
      "index": 12345,
      "lineNumber": 234,
      "context": "function getData() {\n  // TODO: Implement caching\n  return fetchFromAPI();\n}",
      "groups": ["Implement caching"]
    },
    ...
  ]
}
```

**Step 3: Decompose for detailed analysis**
```json
Tool: rlm_decompose_context
{
  "context_id": "code",
  "strategy": "by_lines",
  "lines_per_chunk": 200
}
```

**Step 4: Get chunks containing TODOs**
Based on line numbers from search results, get the relevant chunks for context.

---

### Example 4: Multi-Document Comparison

```
User: "Compare these three contracts and identify differences"
```

**Step 1: Load each document with unique IDs**
```json
Tool: rlm_load_context
{ "context": "...", "context_id": "contract_a" }

Tool: rlm_load_context
{ "context": "...", "context_id": "contract_b" }

Tool: rlm_load_context
{ "context": "...", "context_id": "contract_c" }
```

**Step 2: Get structure of each**
```json
Tool: rlm_get_context_info
{ "context_id": "contract_a" }

Tool: rlm_get_context_info
{ "context_id": "contract_b" }

Tool: rlm_get_context_info
{ "context_id": "contract_c" }
```

**Step 3: Search for key clauses in each**
```json
Tool: rlm_search_context
{
  "context_id": "contract_a",
  "pattern": "termination|liability|indemnif|warranty"
}
```

**Step 4: Store findings for comparison**
```json
Tool: rlm_set_variable
{
  "name": "contract_a_clauses",
  "value": { "termination": "...", "liability": "..." }
}
```

**Step 5: Use code to compare**
```json
Tool: rlm_execute_code
{
  "code": "const a = getVar('contract_a_clauses');\nconst b = getVar('contract_b_clauses');\nconst c = getVar('contract_c_clauses');\n\nconst differences = [];\nObject.keys(a).forEach(key => {\n  if (a[key] !== b[key] || a[key] !== c[key]) {\n    differences.push({ clause: key, a: a[key], b: b[key], c: c[key] });\n  }\n});\n\nsetVar('differences', differences);\nprint(differences.length + ' differences found');"
}
```

---

### Example 5: Data Extraction with REPL

```
User: "Extract all email addresses and phone numbers from this document"
```

**Step 1: Load document**
```json
Tool: rlm_load_context
{
  "context": "Contact John at john@example.com or 555-1234...",
  "context_id": "doc"
}
```

**Step 2: Use code for extraction**
```json
Tool: rlm_execute_code
{
  "code": "const ctx = getContext('doc');\n\n// Extract emails\nconst emailPattern = '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}';\nconst emails = search(emailPattern, ctx);\n\n// Extract phones\nconst phonePattern = '\\\\b\\\\d{3}[-.]?\\\\d{3}[-.]?\\\\d{4}\\\\b';\nconst phones = search(phonePattern, ctx);\n\nconst result = {\n  emails: unique(emails),\n  phones: unique(phones)\n};\n\nprint(JSON.stringify(result, null, 2));\nsetVar('extracted', result);"
}
```

Response:
```json
{
  "success": true,
  "output": "{\n  \"emails\": [\"john@example.com\", \"jane@company.org\"],\n  \"phones\": [\"555-1234\", \"555-5678\"]\n}"
}
```

---

## Advanced Patterns

### Recursive Chunk Processing

When chunks are still too large, the LLM can decompose further:

```
1. Decompose document → 50 sections
2. For large sections, decompose again → subsections
3. Process subsections
4. Aggregate results up
```

### Parallel Information Gathering

Gather multiple pieces of information:

```
1. rlm_search_context for "budget"
2. rlm_search_context for "timeline"  
3. rlm_search_context for "risks"
4. Combine all findings in answer
```

### Stateful Processing

Use variables to maintain state across operations:

```
1. setVar("processed_chunks", [])
2. For each chunk: process and append to array
3. getVar("processed_chunks") to aggregate
4. setAnswer with final result
```

---

### Example 6: Tutorial Resources

```
User: "Teach me how to use the RLM tools"
```

**Step 1: List tutorial resources**
```json
Method: resources/list
{}
```

**Step 2: Read the tutorial index**
```json
Method: resources/read
{
  "uri": "rlm://tutorials"
}
```

**Step 3: Read the first step**
```json
Method: resources/read
{
  "uri": "rlm://tutorials/quickstart/step/1"
}
```

---

## Tips for Best Results

1. **Start with analysis** - Use `rlm_get_context_info` and `rlm_get_statistics` first
2. **Choose right strategy** - Use `rlm_suggest_strategy` for guidance
3. **Search before reading** - Use `rlm_search_context` to find relevant portions
4. **Use code for data work** - `rlm_execute_code` is powerful for manipulation
5. **Build incrementally** - Use `rlm_set_answer` with `ready=false` for drafts
6. **Store intermediate results** - Use variables to avoid re-processing
7. **Keep search output short** - Set `compact: true` or reduce `context_chars`
