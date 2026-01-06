/**
 * RLM MCP Server - Chunk cache
 *
 * Caches decomposition results to avoid recomputation with an LRU strategy.
 */

import { Chunk, DecompositionStrategy } from '../types.js';
import { metrics, MetricNames } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';

/**
 * Cache entry definition
 */
interface CacheEntry {
  chunks: Chunk[];
  strategy: DecompositionStrategy;
  options: DecompositionOptions;
  contentHash: string;
  createdAt: Date;
  lastAccessedAt: Date;
  hitCount: number;
  sizeBytes: number;
}

/**
 * Decomposition options used as part of the cache key
 */
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

/**
 * Cache statistics
 */
interface CacheStats {
  entries: number;
  totalSizeBytes: number;
  hitRate: number;
  totalHits: number;
  totalMisses: number;
}

/**
 * LRU cache for chunked decompositions
 */
export class ChunkCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxEntries: number;
  private maxSizeBytes: number;
  private totalSizeBytes: number = 0;
  private totalHits: number = 0;
  private totalMisses: number = 0;
  
  constructor(options: { maxEntries?: number; maxSizeBytes?: number } = {}) {
    this.maxEntries = options.maxEntries || 100;
    this.maxSizeBytes = options.maxSizeBytes || 100 * 1024 * 1024; // 100MB
  }
  
  /**
   * Build a cache key from the decomposition parameters.
   */
  private generateKey(
    contextId: string,
    sessionId: string,
    strategy: DecompositionStrategy,
    options: DecompositionOptions
  ): string {
    const optionsStr = JSON.stringify(options, Object.keys(options).sort());
    return `${sessionId}:${contextId}:${strategy}:${optionsStr}`;
  }
  
  /**
   * Compute a lightweight content hash for invalidation checks.
   */
  private hashContent(content: string): string {
    // Combine length with small samples to keep hashing cheap.
    const prefix = content.slice(0, 100);
    const suffix = content.slice(-100);
    const sample = content.slice(Math.floor(content.length / 2), Math.floor(content.length / 2) + 100);
    return `${content.length}:${this.simpleHash(prefix + sample + suffix)}`;
  }
  
  /**
   * Simple string hash for the sampled content.
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to a 32-bit integer.
    }
    return Math.abs(hash);
  }
  
  /**
   * Estimate memory usage for cached chunks.
   */
  private estimateChunksSize(chunks: Chunk[]): number {
    return chunks.reduce((total, chunk) => {
      return total + chunk.content.length * 2 + 100; // UTF-16 plus object overhead.
    }, 0);
  }
  
  /**
   * Fetch cached chunks if present and still valid.
   */
  get(
    contextId: string,
    sessionId: string,
    strategy: DecompositionStrategy,
    options: DecompositionOptions,
    contentHash: string
  ): Chunk[] | null {
    const key = this.generateKey(contextId, sessionId, strategy, options);
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.totalMisses++;
      metrics.increment(MetricNames.CACHE_MISSES);
      return null;
    }
    
    // Invalidate entries when the content hash changes.
    if (entry.contentHash !== contentHash) {
      this.cache.delete(key);
      this.totalSizeBytes -= entry.sizeBytes;
      this.totalMisses++;
      metrics.increment(MetricNames.CACHE_MISSES);
      logger.debug('Cache invalidated due to content change', { contextId, strategy });
      return null;
    }
    
    // Update access metadata for LRU.
    entry.lastAccessedAt = new Date();
    entry.hitCount++;
    this.totalHits++;
    metrics.increment(MetricNames.CACHE_HITS);
    
    logger.debug('Cache hit', { contextId, strategy, hitCount: entry.hitCount });
    
    return entry.chunks;
  }
  
  /**
   * Store a cache entry for the given decomposition.
   */
  set(
    contextId: string,
    sessionId: string,
    strategy: DecompositionStrategy,
    options: DecompositionOptions,
    contentHash: string,
    chunks: Chunk[]
  ): void {
    const key = this.generateKey(contextId, sessionId, strategy, options);
    const sizeBytes = this.estimateChunksSize(chunks);
    
    // Evict entries if the cache would exceed limits.
    this.evictIfNeeded(sizeBytes);
    
    // Replace existing entry if present.
    const existing = this.cache.get(key);
    if (existing) {
      this.totalSizeBytes -= existing.sizeBytes;
    }
    
    const entry: CacheEntry = {
      chunks,
      strategy,
      options,
      contentHash,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      hitCount: 0,
      sizeBytes
    };
    
    this.cache.set(key, entry);
    this.totalSizeBytes += sizeBytes;
    
    metrics.gauge(MetricNames.CACHE_SIZE, this.cache.size);
    
    logger.debug('Cache set', { 
      contextId, 
      strategy, 
      chunksCount: chunks.length,
      sizeBytes 
    });
  }
  
  /**
   * Evict entries as needed using an LRU policy.
   */
  private evictIfNeeded(incomingSizeBytes: number): void {
    // Enforce max entry count.
    while (this.cache.size >= this.maxEntries) {
      this.evictLRU();
    }
    
    // Enforce max memory usage.
    while (this.totalSizeBytes + incomingSizeBytes > this.maxSizeBytes && this.cache.size > 0) {
      this.evictLRU();
    }
  }
  
  /**
   * Evict the least recently used cache entry.
   */
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
      const entry = this.cache.get(lruKey);
      if (entry) {
        this.totalSizeBytes -= entry.sizeBytes;
        this.cache.delete(lruKey);
        logger.debug('Cache evicted (LRU)', { key: lruKey });
      }
    }
  }
  
  /**
   * Invalidate all cache entries for a specific context.
   */
  invalidateContext(contextId: string, sessionId: string): number {
    const prefix = `${sessionId}:${contextId}:`;
    let count = 0;
    
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        const entry = this.cache.get(key);
        if (entry) {
          this.totalSizeBytes -= entry.sizeBytes;
        }
        this.cache.delete(key);
        count++;
      }
    }
    
    if (count > 0) {
      logger.debug('Cache entries invalidated', { contextId, count });
      metrics.gauge(MetricNames.CACHE_SIZE, this.cache.size);
    }
    
    return count;
  }
  
  /**
   * Invalidate all cache entries for a session.
   */
  invalidateSession(sessionId: string): number {
    const prefix = `${sessionId}:`;
    let count = 0;
    
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        const entry = this.cache.get(key);
        if (entry) {
          this.totalSizeBytes -= entry.sizeBytes;
        }
        this.cache.delete(key);
        count++;
      }
    }
    
    if (count > 0) {
      logger.debug('Session cache invalidated', { sessionId, count });
      metrics.gauge(MetricNames.CACHE_SIZE, this.cache.size);
    }
    
    return count;
  }
  
  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear();
    this.totalSizeBytes = 0;
    metrics.gauge(MetricNames.CACHE_SIZE, 0);
    logger.info('Cache cleared');
  }
  
  /**
   * Return cache statistics.
   */
  getStats(): CacheStats {
    const total = this.totalHits + this.totalMisses;
    return {
      entries: this.cache.size,
      totalSizeBytes: this.totalSizeBytes,
      hitRate: total > 0 ? this.totalHits / total : 0,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses
    };
  }
  
  /**
   * Create a content hash for external callers.
   */
  createContentHash(content: string): string {
    return this.hashContent(content);
  }
}

// Singleton instance.
export const chunkCache = new ChunkCache();
