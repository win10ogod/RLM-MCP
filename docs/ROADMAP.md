# RLM MCP Server Roadmap

This roadmap focuses on turning the server into a long-context infrastructure layer.
It separates near-term deliverables from medium-term research and longer-term bets.

## Done in this update
- Added `rlm_append_context` for streaming ingestion (append or prepend).
- Fixed `rlm_get_chunks` to honor line and regex decomposition options.
- Added token-aware chunking via `by_tokens` using tiktoken.
- Added opt-in storage for persisted contexts (`RLM_STORAGE_DIR`).
- Added `rlm_rank_chunks` with lexical BM25 scoring and cached indices.
- Improved instrumentation for appended contexts.

## Priority route (identified)
Route A: Storage + Retrieval first. This path reduces memory pressure and improves
retrieval quality before adding heavier semantic models.

Route B: Retrieval + Automation. This path focuses on hybrid retrieval and
automatic recursive workflows once storage is stable.

## Near term (0-2 months)
- Expand persisted storage to include chunk metadata and optional snapshots.
- Improve chunk metadata store (section titles, offsets, structural tags).
- Backpressure controls for HTTP mode (request size and concurrency limits).

## Mid term (2-6 months)
- Hybrid retrieval: embeddings + BM25 + lightweight reranking.
- Pluggable storage backends (filesystem, sqlite, object storage).
- Automatic recursive workflows: map-reduce summaries, claim tracking.
- Session snapshots and resume for long-running analysis.

## Long term (6+ months)
- Evaluation harness integrated into CI for long-context tasks.
- Provenance and citation tracking across chunk processing.
- Multi-tenant isolation with per-session quotas.

## Risks and constraints
- Memory growth from cached chunks and variables.
- Latency spikes when re-analyzing very large contexts.
- Quality depends on client LLM and the retrieval strategy.
