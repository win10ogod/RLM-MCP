/**
 * Context Processor Service - v2.3
 * Provides context decomposition, search, and manipulation utilities.
 * Integrates security checks and caching support.
 */

import {
  Chunk,
  SearchMatch,
  DecompositionStrategy,
  StructureType
} from '../types.js';
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_OVERLAP,
  DEFAULT_LINES_PER_CHUNK,
  DEFAULT_TOKENS_PER_CHUNK,
  DEFAULT_TOKEN_OVERLAP,
  MAX_SEARCH_RESULTS,
  RESOURCE_LIMITS,
  REGEX_LIMITS
} from '../constants.js';
import { Errors, RLMError, ErrorCode } from '../errors/index.js';
import { logger } from '../utils/logger.js';
import { metrics, MetricNames } from '../utils/metrics.js';
import { 
  validateRegexPattern, 
  safeRegexSearch 
} from '../utils/security.js';
import { getTiktokenEncoding, freeEncoding } from '../utils/tokenizer.js';
import { chunkCache } from './chunk-cache.js';

/**
 * Decomposition options
 */
interface DecomposeOptions {
  chunkSize?: number;
  overlap?: number;
  linesPerChunk?: number;
  tokensPerChunk?: number;
  tokenOverlap?: number;
  separator?: string;
  pattern?: string;
  model?: string;
  encoding?: string;
}

export class ContextProcessor {
  
  /**
   * Decompose content into chunks, with optional cache support.
   */
  decompose(
    content: string,
    strategy: DecompositionStrategy,
    options: DecomposeOptions = {},
    cacheInfo?: { contextId: string; sessionId: string }
  ): Chunk[] {
    const timer = metrics.startTimer(MetricNames.DECOMPOSE_DURATION_MS);
    
    try {
      // Try cached chunks first.
      if (cacheInfo) {
        const contentHash = chunkCache.createContentHash(content);
        const cached = chunkCache.get(
          cacheInfo.contextId,
          cacheInfo.sessionId,
          strategy,
          options,
          contentHash
        );
        
        if (cached) {
          logger.debug('Using cached chunks', { 
            contextId: cacheInfo.contextId, 
            strategy,
            chunksCount: cached.length 
          });
          return cached;
        }
      }
      
      // Run decomposition strategy.
      let chunks: Chunk[];
      
      switch (strategy) {
        case DecompositionStrategy.FIXED_SIZE:
          chunks = this.decomposeBySize(
            content,
            options.chunkSize || DEFAULT_CHUNK_SIZE,
            options.overlap || DEFAULT_OVERLAP
          );
          break;
        
        case DecompositionStrategy.BY_LINES:
          chunks = this.decomposeByLines(
            content,
            options.linesPerChunk || DEFAULT_LINES_PER_CHUNK,
            options.overlap || 10
          );
          break;
        
        case DecompositionStrategy.BY_PARAGRAPHS:
          chunks = this.decomposeByParagraphs(content);
          break;
        
        case DecompositionStrategy.BY_SECTIONS:
          chunks = this.decomposeBySections(content);
          break;
        
        case DecompositionStrategy.BY_REGEX:
          chunks = this.decomposeByRegex(content, options.pattern || '\n\n+');
          break;
        
        case DecompositionStrategy.BY_SENTENCES:
          chunks = this.decomposeBySentences(content);
          break;

        case DecompositionStrategy.BY_TOKENS:
          chunks = this.decomposeByTokens(
            content,
            options.tokensPerChunk || DEFAULT_TOKENS_PER_CHUNK,
            options.tokenOverlap || DEFAULT_TOKEN_OVERLAP,
            {
              model: options.model,
              encoding: options.encoding
            }
          );
          break;
        
        default:
          chunks = this.decomposeBySize(content, DEFAULT_CHUNK_SIZE, DEFAULT_OVERLAP);
      }
      
      // Enforce chunk count limits.
      if (chunks.length > RESOURCE_LIMITS.MAX_CHUNKS) {
        throw Errors.chunkLimitExceeded(chunks.length, RESOURCE_LIMITS.MAX_CHUNKS);
      }
      
      // Store results in cache.
      if (cacheInfo) {
        const contentHash = chunkCache.createContentHash(content);
        chunkCache.set(
          cacheInfo.contextId,
          cacheInfo.sessionId,
          strategy,
          options,
          contentHash,
          chunks
        );
      }
      
      logger.debug('Content decomposed', { strategy, chunksCount: chunks.length });
      
      return chunks;
    } finally {
      timer.stop();
    }
  }

  /**
   * Fixed-size chunking with overlap.
   */
  private decomposeBySize(content: string, chunkSize: number, overlap: number): Chunk[] {
    const chunks: Chunk[] = [];
    let index = 0;
    let offset = 0;

    // Prevent infinite loops when overlap is invalid.
    const step = chunkSize - overlap;
    if (step <= 0) {
      throw Errors.invalidInput('overlap', 'Overlap must be smaller than chunk size');
    }

    while (offset < content.length) {
      const end = Math.min(offset + chunkSize, content.length);
      
      chunks.push({
        index,
        content: content.slice(offset, end),
        startOffset: offset,
        endOffset: end
      });

      offset += step;
      index++;

      // Safety cap.
      if (index > RESOURCE_LIMITS.MAX_CHUNKS) break;
    }

    return chunks;
  }

  /**
   * Chunk content by line count.
   */
  private decomposeByLines(content: string, linesPerChunk: number, overlapLines: number): Chunk[] {
    const lines = content.split('\n');
    const chunks: Chunk[] = [];
    let index = 0;
    let lineIndex = 0;
    let charOffset = 0;

    // Precompute line start offsets.
    const lineOffsets: number[] = [0];
    for (let i = 0; i < lines.length - 1; i++) {
      lineOffsets.push(lineOffsets[i] + lines[i].length + 1);
    }

    const advanceLines = Math.max(1, linesPerChunk - overlapLines);

    while (lineIndex < lines.length) {
      const endLineIndex = Math.min(lineIndex + linesPerChunk, lines.length);
      const chunkLines = lines.slice(lineIndex, endLineIndex);
      const chunkContent = chunkLines.join('\n');
      
      const startOffset = lineOffsets[lineIndex];
      const endOffset = lineIndex + linesPerChunk >= lines.length 
        ? content.length 
        : lineOffsets[endLineIndex];

      chunks.push({
        index,
        content: chunkContent,
        startOffset,
        endOffset,
        metadata: {
          startLine: lineIndex,
          endLine: endLineIndex - 1,
          lineCount: chunkLines.length
        }
      });

      lineIndex += advanceLines;
      index++;

      // Safety cap.
      if (index > RESOURCE_LIMITS.MAX_CHUNKS) break;
    }

    return chunks;
  }

  /**
   * Chunk content by paragraphs (double newlines).
   */
  private decomposeByParagraphs(content: string): Chunk[] {
    const paragraphs = content.split(/\n\n+/);
    const chunks: Chunk[] = [];
    let offset = 0;
    let index = 0;

    for (const para of paragraphs) {
      const trimmedPara = para.trim();
      if (trimmedPara) {
        // Find the real offsets relative to the original content.
        const actualStart = content.indexOf(para, offset);
        const startOffset = actualStart >= 0 ? actualStart : offset;
        
        chunks.push({
          index,
          content: trimmedPara,
          startOffset,
          endOffset: startOffset + para.length,
          metadata: {
            type: 'paragraph',
            originalLength: para.length
          }
        });
        
        offset = startOffset + para.length;
        index++;

        // Safety cap.
        if (index > RESOURCE_LIMITS.MAX_CHUNKS) break;
      }
    }

    return chunks;
  }

  /**
   * Chunk content by Markdown section headers.
   */
  private decomposeBySections(content: string): Chunk[] {
    const sectionPattern = /^(#{1,6})\s+(.+)$/gm;
    const sections: Chunk[] = [];
    let index = 0;

    const matches: Array<{ start: number; level: number; title: string }> = [];
    let match;
    
    while ((match = sectionPattern.exec(content)) !== null) {
      matches.push({
        start: match.index,
        level: match[1].length,
        title: match[2]
      });
    }

    // If no headers exist, return a single chunk.
    if (matches.length === 0) {
      return [{
        index: 0,
        content: content,
        startOffset: 0,
        endOffset: content.length,
        metadata: { type: 'single' }
      }];
    }

    // Include preamble content before the first header.
    if (matches[0].start > 0) {
      const preContent = content.slice(0, matches[0].start).trim();
      if (preContent) {
        sections.push({
          index: index++,
          content: preContent,
          startOffset: 0,
          endOffset: matches[0].start,
          metadata: { type: 'preamble' }
        });
      }
    }

    // Split each section by header boundaries.
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const next = matches[i + 1];
      const endOffset = next ? next.start : content.length;
      
      sections.push({
        index: index++,
        content: content.slice(current.start, endOffset).trim(),
        startOffset: current.start,
        endOffset,
        metadata: {
          level: current.level,
          title: current.title,
          type: 'section'
        }
      });

      // Safety cap.
      if (index > RESOURCE_LIMITS.MAX_CHUNKS) break;
    }

    return sections;
  }

  /**
   * Chunk content by a custom regex separator.
   */
  private decomposeByRegex(content: string, pattern: string): Chunk[] {
    // Validate regex safety before use.
    const validation = validateRegexPattern(pattern);
    if (!validation.valid) {
      throw Errors.invalidRegex(pattern, validation.error!);
    }

    const regex = new RegExp(pattern, 'g');
    const parts = content.split(regex);
    const chunks: Chunk[] = [];
    let offset = 0;
    let index = 0;

    for (const part of parts) {
      const trimmedPart = part.trim();
      if (trimmedPart) {
        const actualStart = content.indexOf(part, offset);
        const startOffset = actualStart >= 0 ? actualStart : offset;
        
        chunks.push({
          index,
          content: trimmedPart,
          startOffset,
          endOffset: startOffset + part.length
        });
        
        offset = startOffset + part.length;
        index++;

        // Safety cap.
        if (index > RESOURCE_LIMITS.MAX_CHUNKS) break;
      }
    }

    return chunks;
  }

  /**
   * Chunk content by sentence boundaries.
   */
  private decomposeBySentences(content: string): Chunk[] {
    // Sentence splitter tuned for simple punctuation-based boundaries.
    const sentencePattern = /[^.!?]+[.!?]+[\s]*/g;
    const sentences: Chunk[] = [];
    let match;
    let index = 0;

    while ((match = sentencePattern.exec(content)) !== null) {
      const trimmed = match[0].trim();
      if (trimmed) {
        sentences.push({
          index: index++,
          content: trimmed,
          startOffset: match.index,
          endOffset: match.index + match[0].length,
          metadata: {
            type: 'sentence'
          }
        });
      }

      // Safety cap.
      if (index > RESOURCE_LIMITS.MAX_CHUNKS) break;
    }

    // Handle content without terminal punctuation.
    if (sentences.length === 0 && content.trim()) {
      return [{
        index: 0,
        content: content.trim(),
        startOffset: 0,
        endOffset: content.length,
        metadata: { type: 'single' }
      }];
    }

    return sentences;
  }

  /**
   * Chunk content by token count using tiktoken.
   */
  private decomposeByTokens(
    content: string,
    tokensPerChunk: number,
    overlapTokens: number,
    tokenizerOptions: { model?: string; encoding?: string }
  ): Chunk[] {
    if (tokensPerChunk <= 0) {
      throw Errors.invalidInput('tokens_per_chunk', 'Tokens per chunk must be greater than 0');
    }

    if (overlapTokens < 0) {
      throw Errors.invalidInput('token_overlap', 'Token overlap must be 0 or greater');
    }

    const step = tokensPerChunk - overlapTokens;
    if (step <= 0) {
      throw Errors.invalidInput('token_overlap', 'Token overlap must be smaller than tokens_per_chunk');
    }

    const encoding = getTiktokenEncoding(tokenizerOptions);

    try {
      const tokens = encoding.encode(content);
      const tokenLengths = new Array(tokens.length);
      const tokenOffsets = new Array(tokens.length + 1);
      tokenOffsets[0] = 0;

      for (let i = 0; i < tokens.length; i++) {
        const tokenText = encoding.decode([tokens[i]]);
        tokenLengths[i] = tokenText.length;
        tokenOffsets[i + 1] = tokenOffsets[i] + tokenLengths[i];
      }

      const chunks: Chunk[] = [];
      let index = 0;

      for (let start = 0; start < tokens.length; start += step) {
        const end = Math.min(start + tokensPerChunk, tokens.length);
        const chunkTokens = tokens.slice(start, end);
        const chunkText = encoding.decode(chunkTokens);

        chunks.push({
          index,
          content: chunkText,
          startOffset: tokenOffsets[start],
          endOffset: tokenOffsets[end],
          metadata: {
            token_start: start,
            token_end: end,
            token_count: end - start,
            model: tokenizerOptions.model,
            encoding: tokenizerOptions.encoding
          }
        });

        index++;

        if (index > RESOURCE_LIMITS.MAX_CHUNKS) break;
      }

      return chunks;
    } finally {
      freeEncoding(encoding);
    }
  }

  /**
   * Search content with a safe regex implementation.
   */
  async search(
    content: string,
    pattern: string,
    options: {
      flags?: string;
      contextChars?: number;
      maxResults?: number;
      includeLineNumbers?: boolean;
    } = {}
  ): Promise<SearchMatch[]> {
    const timer = metrics.startTimer(MetricNames.SEARCH_DURATION_MS);
    metrics.increment(MetricNames.SEARCHES);
    
    const {
      flags = 'gi',
      contextChars = 100,
      maxResults = MAX_SEARCH_RESULTS,
      includeLineNumbers = true
    } = options;

    try {
      // Run the safe regex search with limits.
      const matches = await safeRegexSearch(pattern, content, {
        flags,
        timeoutMs: REGEX_LIMITS.MAX_EXECUTION_TIME_MS,
        maxMatches: maxResults
      });
      
      const results: SearchMatch[] = [];
      
      // Precompute line starts for binary search.
      let lineStarts: number[] = [];
      if (includeLineNumbers) {
        lineStarts = [0];
        for (let i = 0; i < content.length; i++) {
          if (content[i] === '\n') {
            lineStarts.push(i + 1);
          }
        }
      }
      
      for (const match of matches) {
        if (match.index === undefined) {
          continue;
        }

        const matchIndex = match.index;
        const start = Math.max(0, matchIndex - contextChars);
        const end = Math.min(content.length, matchIndex + match[0].length + contextChars);
        
        let lineNumber = 0;
        if (includeLineNumbers) {
          // Binary search to locate the line number.
          let low = 0, high = lineStarts.length - 1;
          while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (lineStarts[mid] <= matchIndex) {
              low = mid;
            } else {
              high = mid - 1;
            }
          }
          lineNumber = low + 1; // 1-based
        }

        results.push({
          match: match[0],
          index: matchIndex,
          lineNumber,
          context: content.slice(start, end),
          groups: match.slice(1)
        });
      }
      
      return results;
    } catch (error) {
      if (error instanceof RLMError) throw error;
      throw Errors.invalidRegex(pattern, (error as Error).message);
    } finally {
      timer.stop();
    }
  }

  /**
   * Synchronous search for legacy callers.
   */
  searchSync(
    content: string,
    pattern: string,
    options: {
      flags?: string;
      contextChars?: number;
      maxResults?: number;
      includeLineNumbers?: boolean;
    } = {}
  ): SearchMatch[] {
    const {
      flags = 'gi',
      contextChars = 100,
      maxResults = MAX_SEARCH_RESULTS,
      includeLineNumbers = true
    } = options;

    const results: SearchMatch[] = [];
    
    // Validate regex safety before running.
    const validation = validateRegexPattern(pattern);
    if (!validation.valid) {
      logger.warn('Invalid regex pattern in searchSync', { pattern, error: validation.error });
      return results;
    }
    
    try {
      const regex = new RegExp(pattern, flags);
      let match;
      
      while ((match = regex.exec(content)) !== null && results.length < maxResults) {
        const start = Math.max(0, match.index - contextChars);
        const end = Math.min(content.length, match.index + match[0].length + contextChars);
        
        let lineNumber = 0;
        if (includeLineNumbers) {
          lineNumber = content.slice(0, match.index).split('\n').length;
        }

        results.push({
          match: match[0],
          index: match.index,
          lineNumber,
          context: content.slice(start, end),
          groups: match.slice(1)
        });

        // Prevent infinite loops on zero-length matches.
        if (match[0].length === 0) {
          regex.lastIndex++;
        }
      }
    } catch (error) {
      logger.warn('Regex search error', { pattern, error: (error as Error).message });
    }

    return results;
  }

  /**
   * Extract a line range from content.
   */
  extractLines(content: string, startLine: number, endLine?: number): string {
    const lines = content.split('\n');
    const end = endLine !== undefined ? endLine + 1 : startLine + 1;
    return lines.slice(startLine, end).join('\n');
  }

  /**
   * Extract a character range from content.
   */
  extractRange(content: string, start: number, end: number): string {
    return content.slice(start, end);
  }

  /**
   * Compute basic statistics for a context.
   */
  getStatistics(content: string): {
    length: number;
    lineCount: number;
    wordCount: number;
    sentenceCount: number;
    paragraphCount: number;
    avgLineLength: number;
    avgWordLength: number;
    charFrequency?: Record<string, number>;
  } {
    const lines = content.split('\n');
    const words = content.split(/\s+/).filter(w => w.length > 0);
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0);

    return {
      length: content.length,
      lineCount: lines.length,
      wordCount: words.length,
      sentenceCount: sentences.length,
      paragraphCount: paragraphs.length,
      avgLineLength: lines.length > 0 ? Math.round(content.length / lines.length) : 0,
      avgWordLength: words.length > 0 ? Math.round(words.join('').length / words.length) : 0
    };
  }

  /**
   * Find all substring offsets in content.
   */
  findAll(content: string, substring: string, caseSensitive: boolean = false): number[] {
    const indices: number[] = [];
    const searchContent = caseSensitive ? content : content.toLowerCase();
    const searchTerm = caseSensitive ? substring : substring.toLowerCase();
    
    if (searchTerm.length === 0) return indices;
    
    let index = 0;
    const maxResults = REGEX_LIMITS.MAX_MATCHES;
    
    while ((index = searchContent.indexOf(searchTerm, index)) !== -1 && indices.length < maxResults) {
      indices.push(index);
      index += searchTerm.length;
    }
    
    return indices;
  }

  /**
   * Suggest a decomposition strategy based on content structure.
   */
  suggestStrategy(content: string, structure: StructureType): {
    strategy: DecompositionStrategy;
    reason: string;
    options: Record<string, unknown>;
  } {
    const stats = this.getStatistics(content);

    // Structured data handling.
    if (structure === StructureType.JSON) {
      return {
        strategy: DecompositionStrategy.FIXED_SIZE,
        reason: 'JSON data works best with fixed-size chunks to avoid breaking structure',
        options: { chunkSize: 20000, overlap: 500 }
      };
    }

    if (structure === StructureType.CSV) {
      return {
        strategy: DecompositionStrategy.BY_LINES,
        reason: 'CSV data should be chunked by rows to preserve record integrity',
        options: { linesPerChunk: 200, overlap: 0 }
      };
    }

    if (structure === StructureType.MARKDOWN) {
      return {
        strategy: DecompositionStrategy.BY_SECTIONS,
        reason: 'Markdown content has natural section boundaries',
        options: {}
      };
    }

    if (structure === StructureType.CODE) {
      return {
        strategy: DecompositionStrategy.BY_LINES,
        reason: 'Code should be chunked by lines to preserve context',
        options: { linesPerChunk: 100, overlap: 20 }
      };
    }

    if (structure === StructureType.LOG) {
      return {
        strategy: DecompositionStrategy.BY_LINES,
        reason: 'Log files are naturally line-based',
        options: { linesPerChunk: 500, overlap: 50 }
      };
    }

    // Plain text heuristics.
    if (stats.paragraphCount > 10) {
      return {
        strategy: DecompositionStrategy.BY_PARAGRAPHS,
        reason: 'Document has clear paragraph structure',
        options: {}
      };
    }

    if (stats.length > 50000) {
      return {
        strategy: DecompositionStrategy.FIXED_SIZE,
        reason: 'Large document requires fixed-size chunking',
        options: { chunkSize: 10000, overlap: 200 }
      };
    }

    return {
      strategy: DecompositionStrategy.BY_SENTENCES,
      reason: 'Default to sentence-based chunking for general text',
      options: {}
    };
  }
}

// Singleton instance.
export const contextProcessor = new ContextProcessor();
