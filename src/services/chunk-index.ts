import { INDEX_CONFIG } from '../constants.js';
import { chunkCache } from './chunk-cache.js';
import type { Chunk, DecompositionStrategy } from '../types.js';
import { metrics, MetricNames } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';

interface DecompositionOptions {
  chunkSize?: number;
  overlap?: number;
  linesPerChunk?: number;
  tokensPerChunk?: number;
  tokenOverlap?: number;
  pattern?: string;
  model?: string;
  encoding?: string;
}

interface Posting {
  docId: number;
  tf: number;
}

interface ChunkMeta {
  index: number;
  startOffset: number;
  endOffset: number;
  length: number;
  metadata?: Record<string, unknown>;
}

interface IndexEntry {
  contentHash: string;
  createdAt: Date;
  lastAccessedAt: Date;
  hitCount: number;
  chunkCount: number;
  avgDocLength: number;
  docLengths: number[];
  postings: Map<string, Posting[]>;
  chunkMetadata: ChunkMeta[];
}

interface IndexStats {
  entries: number;
  hits: number;
  misses: number;
}

export interface RankedChunk {
  index: number;
  score: number;
}

export class ChunkIndex {
  private cache: Map<string, IndexEntry> = new Map();
  private maxEntries: number;
  private hits = 0;
  private misses = 0;

  constructor(options: { maxEntries?: number } = {}) {
    this.maxEntries = options.maxEntries || INDEX_CONFIG.MAX_ENTRIES;
  }

  getOrBuildIndex(
    contextId: string,
    sessionId: string,
    strategy: DecompositionStrategy,
    options: DecompositionOptions,
    content: string,
    chunks: Chunk[]
  ): IndexEntry {
    const contentHash = chunkCache.createContentHash(content);
    const key = this.generateKey(contextId, sessionId, strategy, options);

    const existing = this.cache.get(key);
    if (existing && existing.contentHash === contentHash) {
      existing.lastAccessedAt = new Date();
      existing.hitCount += 1;
      this.hits += 1;
      metrics.increment(MetricNames.INDEX_HITS);
      return existing;
    }

    if (existing) {
      this.cache.delete(key);
    }

    const entry = this.buildIndex(contentHash, chunks);
    this.setEntry(key, entry);
    this.misses += 1;
    metrics.increment(MetricNames.INDEX_MISSES);
    return entry;
  }

  rank(entry: IndexEntry, query: string, topK: number, minScore?: number): RankedChunk[] {
    const queryTerms = tokenizeText(query);
    if (queryTerms.length === 0 || entry.chunkCount === 0) {
      return [];
    }

    const queryFreqs = new Map<string, number>();
    for (const term of queryTerms) {
      queryFreqs.set(term, (queryFreqs.get(term) || 0) + 1);
    }

    const scores = new Array(entry.chunkCount).fill(0);
    const k1 = INDEX_CONFIG.K1;
    const b = INDEX_CONFIG.B;

    for (const [term, qf] of queryFreqs.entries()) {
      const postings = entry.postings.get(term);
      if (!postings || postings.length === 0) continue;

      const df = postings.length;
      const idf = Math.log(1 + (entry.chunkCount - df + 0.5) / (df + 0.5));

      for (const posting of postings) {
        const docLen = entry.docLengths[posting.docId];
        const tf = posting.tf;
        const denom = tf + k1 * (1 - b + b * (docLen / entry.avgDocLength));
        const score = idf * ((tf * (k1 + 1)) / denom) * qf;
        scores[posting.docId] += score;
      }
    }

    const results: RankedChunk[] = [];
    for (let i = 0; i < scores.length; i++) {
      const score = scores[i];
      if (score <= 0) continue;
      if (minScore !== undefined && score < minScore) continue;
      results.push({ index: i, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  getChunkMetadata(entry: IndexEntry, chunkIndex: number): ChunkMeta | undefined {
    return entry.chunkMetadata[chunkIndex];
  }

  invalidateContext(contextId: string, sessionId: string): number {
    const prefix = `${sessionId}:${contextId}:`;
    let count = 0;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count += 1;
      }
    }

    if (count > 0) {
      metrics.gauge(MetricNames.INDEX_SIZE, this.cache.size);
    }

    return count;
  }

  invalidateSession(sessionId: string): number {
    const prefix = `${sessionId}:`;
    let count = 0;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count += 1;
      }
    }

    if (count > 0) {
      metrics.gauge(MetricNames.INDEX_SIZE, this.cache.size);
    }

    return count;
  }

  getStats(): IndexStats {
    return {
      entries: this.cache.size,
      hits: this.hits,
      misses: this.misses
    };
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    metrics.gauge(MetricNames.INDEX_SIZE, 0);
  }

  private buildIndex(contentHash: string, chunks: Chunk[]): IndexEntry {
    const postings = new Map<string, Posting[]>();
    const docLengths: number[] = [];
    const chunkMetadata: ChunkMeta[] = [];
    let totalLength = 0;

    for (const chunk of chunks) {
      const terms = tokenizeText(chunk.content);
      const termFreqs = new Map<string, number>();
      for (const term of terms) {
        termFreqs.set(term, (termFreqs.get(term) || 0) + 1);
      }

      const docId = chunk.index;
      docLengths[docId] = terms.length;
      totalLength += terms.length;

      for (const [term, tf] of termFreqs.entries()) {
        const list = postings.get(term);
        if (list) {
          list.push({ docId, tf });
        } else {
          postings.set(term, [{ docId, tf }]);
        }
      }

      chunkMetadata[docId] = {
        index: chunk.index,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        length: chunk.content.length,
        metadata: chunk.metadata
      };
    }

    const chunkCount = chunks.length;
    const avgDocLength = chunkCount > 0 ? totalLength / chunkCount : 0;

    metrics.increment(MetricNames.INDEX_BUILDS);

    return {
      contentHash,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      hitCount: 0,
      chunkCount,
      avgDocLength,
      docLengths,
      postings,
      chunkMetadata
    };
  }

  private setEntry(key: string, entry: IndexEntry): void {
    if (this.cache.size >= this.maxEntries) {
      this.evictLRU();
    }

    this.cache.set(key, entry);
    metrics.gauge(MetricNames.INDEX_SIZE, this.cache.size);
    logger.debug('Chunk index stored', { key, chunks: entry.chunkCount });
  }

  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [key, entry] of this.cache) {
      const accessTime = entry.lastAccessedAt.getTime();
      if (accessTime < lruTime) {
        lruTime = accessTime;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
    }
  }

  private generateKey(
    contextId: string,
    sessionId: string,
    strategy: DecompositionStrategy,
    options: DecompositionOptions
  ): string {
    const normalized = normalizeOptions(options);
    const optionsStr = JSON.stringify(normalized, Object.keys(normalized).sort());
    return `${sessionId}:${contextId}:${strategy}:${optionsStr}`;
  }
}

function normalizeOptions(options: DecompositionOptions): DecompositionOptions {
  return {
    chunkSize: options.chunkSize,
    overlap: options.overlap,
    linesPerChunk: options.linesPerChunk,
    tokensPerChunk: options.tokensPerChunk,
    tokenOverlap: options.tokenOverlap,
    pattern: options.pattern,
    model: options.model,
    encoding: options.encoding
  };
}

function tokenizeText(text: string): string[] {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  return matches ? matches : [];
}

export const chunkIndex = new ChunkIndex();
