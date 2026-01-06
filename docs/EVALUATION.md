# Evaluation Plan for Long-Context Workflows

This plan measures whether the server helps clients answer questions over very long inputs.
It focuses on retrieval quality, fidelity, latency, and resource usage.

## 1) Retrieval quality
- Metrics: recall@k, precision@k, MRR for chunk retrieval.
- Tasks: keyword lookup, section retrieval, and multi-hop queries.
- Datasets: LongBench, RULER, NarrativeQA, GovReport, custom docs.
- Procedure: place answer spans in known chunks and verify recall of top-k chunks.

## 2) Answer fidelity
- Metrics: exact match, F1, ROUGE-L, citation accuracy, hallucination rate.
- Tasks: long-doc QA, summarization, and information extraction.
- Procedure: compare client LLM outputs against reference answers with citations.

## 3) Lost-in-the-middle sensitivity
- Metrics: accuracy by answer position (start, middle, end).
- Procedure: duplicate test cases with answers placed at different offsets.

## 4) Latency and throughput
- Metrics: p50/p95 tool latency, end-to-end wall time, requests/sec.
- Sources: `rlm_get_metrics` histograms and external wall-clock timing.
- Targets: stable p95 under large context sizes and repeated decompositions.

## 5) Resource usage
- Metrics: peak RSS, session memory, cache size, VM execution timeouts.
- Procedure: run max-size contexts and observe memory/cpu budgets.

## 6) Robustness and safety
- Tests: adversarial regex patterns, malformed inputs, repeated tokens.
- Metrics: error rates, timeout rates, and successful recovery.

## 7) Regression harness
- Maintain a fixed suite of representative contexts and prompts.
- Track results over time with versioned baselines.
- Gate releases on no regression in recall@k and latency targets.
