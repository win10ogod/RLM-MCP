/**
 * RLM MCP Server Tools - v2.4
 *
 * Tool layer with centralized error handling, logging, and metrics.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, TextContent } from '@modelcontextprotocol/sdk/types.js';
import { sessionManager } from '../services/session-manager.js';
import { contextProcessor } from '../services/context-processor.js';
import { chunkCache } from '../services/chunk-cache.js';
import { chunkIndex } from '../services/chunk-index.js';
import { queryCache } from '../services/query-cache.js';
import { RLMError, Errors } from '../errors/index.js';
import { logger } from '../utils/logger.js';
import { metrics, MetricNames } from '../utils/metrics.js';
import type { DecompositionOptions } from '../types.js';
import {
  LoadContextInputSchema,
  AppendContextInputSchema,
  LoadContextFromStorageInputSchema,
  UnloadContextInputSchema,
  GetContextInfoInputSchema,
  ReadContextInputSchema,
  DecomposeContextInputSchema,
  GetChunksInputSchema,
  SearchContextInputSchema,
  FindAllInputSchema,
  RankChunksInputSchema,
  ExecuteCodeInputSchema,
  SetVariableInputSchema,
  GetVariableInputSchema,
  SetAnswerInputSchema,
  GetAnswerInputSchema,
  CreateSessionInputSchema,
  GetSessionInfoInputSchema,
  ClearSessionInputSchema,
  SuggestStrategyInputSchema,
  GetStatisticsInputSchema,
  GetMetricsInputSchema,
  type LoadContextInput,
  type AppendContextInput,
  type LoadContextFromStorageInput,
  type UnloadContextInput,
  type GetContextInfoInput,
  type ReadContextInput,
  type DecomposeContextInput,
  type GetChunksInput,
  type SearchContextInput,
  type FindAllInput,
  type RankChunksInput,
  type ExecuteCodeInput,
  type SetVariableInput,
  type GetVariableInput,
  type SetAnswerInput,
  type GetAnswerInput,
  type CreateSessionInput,
  type GetSessionInfoInput,
  type ClearSessionInput,
  type SuggestStrategyInput,
  type GetStatisticsInput,
  type GetMetricsInput
} from '../schemas/tools.js';
import { CHARACTER_LIMIT } from '../constants.js';

/**
 * Tool execution wrapper with consistent error handling and logging.
 */
async function executeWithTracking<T>(
  toolName: string,
  params: Record<string, unknown>,
  handler: () => Promise<T>
): Promise<CallToolResult> {
  const traceId = logger.startToolCall(toolName, params);
  const timer = metrics.startTimer(MetricNames.TOOL_DURATION_MS);
  
  metrics.increment(MetricNames.TOOL_CALLS_TOTAL);
  
  try {
    const result = await handler();
    
    timer.stop();
    metrics.increment(MetricNames.TOOL_CALLS_SUCCESS);
    logger.endToolCall(traceId, true);
    
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    const content: TextContent[] = [{ type: 'text', text }];
    const structuredContent = isStructuredContent(result) ? result : undefined;
    
    return {
      content,
      ...(structuredContent ? { structuredContent } : {})
    };
  } catch (error) {
    timer.stop();
    metrics.increment(MetricNames.TOOL_CALLS_FAILED);
    
    const rlmError = error instanceof RLMError 
      ? error 
      : RLMError.fromError(error, traceId);
    
    logger.toolError(traceId, rlmError);
    
    return rlmError.toMCPResponse();
  }
}

function isStructuredContent(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildDecomposeOptions(params: {
  chunk_size?: number;
  overlap?: number;
  lines_per_chunk?: number;
  tokens_per_chunk?: number;
  token_overlap?: number;
  merge_empty_sections?: boolean;
  min_section_length?: number;
  model?: string;
  encoding?: string;
  pattern?: string;
}): DecompositionOptions {
  return {
    chunkSize: params.chunk_size,
    overlap: params.overlap,
    linesPerChunk: params.lines_per_chunk,
    tokensPerChunk: params.tokens_per_chunk,
    tokenOverlap: params.token_overlap,
    mergeEmptySections: params.merge_empty_sections,
    minSectionLength: params.min_section_length,
    model: params.model,
    encoding: params.encoding,
    pattern: params.pattern
  };
}

/**
 * Register all RLM tools.
 */
export function registerRLMTools(server: McpServer): void {

  // ============================================
  // Context management tools
  // ============================================

  server.registerTool(
    'rlm_load_context',
    {
      title: 'Load Context',
      description: `Load text content into the RLM session for processing.

This is typically the first step in RLM processing. Load your long context here,
then use other tools to decompose, search, and analyze it.

The context is stored in the session and can be referenced by its ID in other tools.

Example workflow:
1. rlm_load_context - Load your document
2. rlm_get_context_info - Understand structure and size
3. rlm_decompose_context - Split into manageable chunks
4. rlm_search_context - Find relevant sections
5. rlm_read_context - Read specific portions
6. rlm_set_answer - Build up your response`,
      inputSchema: LoadContextInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: LoadContextInput) => {
      return executeWithTracking('rlm_load_context', params as Record<string, unknown>, async () => {
        const session = params.session_id 
          ? sessionManager.getSession(params.session_id)
          : sessionManager.getDefaultSession();
        
        if (!session) {
          throw Errors.sessionNotFound(params.session_id || 'default');
        }

        const contextItem = sessionManager.loadContext(
          session.id,
          params.context_id,
          params.context
        );

        return {
          success: true,
          context_id: params.context_id,
          session_id: session.id,
          metadata: contextItem.metadata
        };
      });
    }
  );

  server.registerTool(
    'rlm_append_context',
    {
      title: 'Append Context',
      description: `Append or prepend text to an existing context.

Use this to stream large inputs in smaller pieces without re-sending the full context.

Example workflow:
1. rlm_load_context - Load the first chunk
2. rlm_append_context - Append subsequent chunks
3. rlm_get_context_info - Verify final size and structure`,
      inputSchema: AppendContextInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (params: AppendContextInput) => {
      return executeWithTracking('rlm_append_context', params as Record<string, unknown>, async () => {
        const session = params.session_id
          ? sessionManager.getSession(params.session_id)
          : sessionManager.getDefaultSession();

        if (!session) {
          throw Errors.sessionNotFound(params.session_id || 'default');
        }

        const existed = session.contexts.has(params.context_id);
        const contextItem = sessionManager.appendContext(
          session.id,
          params.context_id,
          params.content,
          {
            mode: params.mode,
            createIfMissing: params.create_if_missing
          }
        );

        return {
          success: true,
          context_id: params.context_id,
          session_id: session.id,
          created: !existed,
          mode: params.mode,
          metadata: contextItem.metadata
        };
      });
    }
  );

  server.registerTool(
    'rlm_load_context_from_storage',
    {
      title: 'Load Context From Storage',
      description: `Load a persisted context into memory.

Requires RLM_STORAGE_DIR to be configured on the server.`,
      inputSchema: LoadContextFromStorageInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (params: LoadContextFromStorageInput) => {
      return executeWithTracking('rlm_load_context_from_storage', params as Record<string, unknown>, async () => {
        const session = params.session_id
          ? sessionManager.getSession(params.session_id)
          : sessionManager.getDefaultSession();

        if (!session) {
          throw Errors.sessionNotFound(params.session_id || 'default');
        }

        const contextItem = sessionManager.loadContextFromStorage(session.id, params.context_id);

        return {
          success: true,
          context_id: params.context_id,
          session_id: session.id,
          metadata: contextItem.metadata
        };
      });
    }
  );

  server.registerTool(
    'rlm_unload_context',
    {
      title: 'Unload Context',
      description: `Unload a context from memory while keeping persisted storage.

If storage is configured, the latest version is saved before unloading.`,
      inputSchema: UnloadContextInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: UnloadContextInput) => {
      return executeWithTracking('rlm_unload_context', params as Record<string, unknown>, async () => {
        const session = params.session_id
          ? sessionManager.getSession(params.session_id)
          : sessionManager.getDefaultSession();

        if (!session) {
          throw Errors.sessionNotFound(params.session_id || 'default');
        }

        const unloaded = sessionManager.unloadContext(session.id, params.context_id);
        if (!unloaded) {
          throw Errors.contextNotFound(params.context_id, session.id);
        }

        return {
          success: true,
          context_id: params.context_id,
          session_id: session.id
        };
      });
    }
  );

  server.registerTool(
    'rlm_get_context_info',
    {
      title: 'Get Context Info',
      description: `Get metadata and preview of a loaded context.

Returns:
- Length, line count, word count
- Detected structure type (json, csv, markdown, code, etc.)
- Optional content preview

Use this to understand the context before deciding how to process it.`,
      inputSchema: GetContextInfoInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: GetContextInfoInput) => {
      return executeWithTracking('rlm_get_context_info', params as Record<string, unknown>, async () => {
        const session = params.session_id
          ? sessionManager.getSession(params.session_id)
          : sessionManager.getDefaultSession();

        if (!session) {
          throw Errors.sessionNotFound(params.session_id || 'default');
        }

        const context = session.contexts.get(params.context_id);
        
        if (!context) {
          throw Errors.contextNotFound(params.context_id, params.session_id);
        }

        const output: Record<string, unknown> = {
          context_id: params.context_id,
          metadata: context.metadata,
          created_at: context.createdAt.toISOString()
        };

        if (params.include_preview) {
          output.preview = context.content.slice(0, params.preview_length);
          if (context.content.length > params.preview_length) {
            output.preview_truncated = true;
          }
        }

        return output;
      });
    }
  );

  server.registerTool(
    'rlm_read_context',
    {
      title: 'Read Context Portion',
      description: `Read a specific portion of the context.

Modes:
- chars: Read by character offsets (start, end)
- lines: Read by line numbers (start, end)

Use this to examine specific sections without loading the entire context.`,
      inputSchema: ReadContextInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: ReadContextInput) => {
      return executeWithTracking('rlm_read_context', params as Record<string, unknown>, async () => {
        const session = params.session_id
          ? sessionManager.getSession(params.session_id)
          : sessionManager.getDefaultSession();

        if (!session) {
          throw Errors.sessionNotFound(params.session_id || 'default');
        }

        const context = session?.contexts.get(params.context_id);
        
        if (!context) {
          throw Errors.contextNotFound(params.context_id, params.session_id);
        }

        let content: string;
        
        if (params.mode === 'lines') {
          content = contextProcessor.extractLines(
            context.content,
            params.start,
            params.end
          );
        } else {
          content = contextProcessor.extractRange(
            context.content,
            params.start,
            params.end || context.content.length
          );
        }

        return {
          content,
          start: params.start,
          end: params.end,
          mode: params.mode,
          length: content.length
        };
      });
    }
  );

  // ============================================
  // Decomposition tools
  // ============================================

  server.registerTool(
    'rlm_decompose_context',
    {
      title: 'Decompose Context',
      description: `Split context into chunks using various strategies.

Strategies:
- fixed_size: Fixed character chunks with overlap
- by_lines: Chunk by number of lines
- by_paragraphs: Split on double newlines
- by_sections: Split on markdown headers
- by_regex: Split on custom pattern
- by_sentences: Split into sentences
- by_tokens: Chunk by token count (tiktoken)

Returns chunk metadata (indices, offsets) plus a decompose_id to reuse later.
Use rlm_get_chunks with decompose_id to avoid repeating options.

Note: Results are cached for performance. Cache is invalidated when context is updated.`,
      inputSchema: DecomposeContextInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: DecomposeContextInput) => {
      return executeWithTracking('rlm_decompose_context', params as Record<string, unknown>, async () => {
        const session = params.session_id
          ? sessionManager.getSession(params.session_id)
          : sessionManager.getDefaultSession();

        if (!session) {
          throw Errors.sessionNotFound(params.session_id || 'default');
        }

        const context = session?.contexts.get(params.context_id);
        
        if (!context) {
          throw Errors.contextNotFound(params.context_id, params.session_id);
        }

        const decomposeOptions = buildDecomposeOptions(params);
        const chunks = contextProcessor.decompose(
          context.content,
          params.strategy,
          decomposeOptions,
          { contextId: params.context_id, sessionId: session?.id || 'default' }
        );

        const decomposeRecord = sessionManager.storeDecomposition(
          session.id,
          params.context_id,
          params.strategy,
          decomposeOptions
        );

        // Assemble output payload.
        const output: Record<string, unknown> = {
          total_chunks: chunks.length,
          strategy: params.strategy,
          decompose_id: decomposeRecord.id,
          chunks: chunks.map(c => ({
            index: c.index,
            start_offset: c.startOffset,
            end_offset: c.endOffset,
            length: c.content.length,
            ...(c.metadata || {}),
            ...(params.return_content ? { content: c.content } : {})
          }))
        };

        // Enforce response size limits.
        let text = JSON.stringify(output, null, 2);
        if (text.length > CHARACTER_LIMIT) {
          // Return a summary when the payload is too large.
          output.chunks = chunks.slice(0, 10).map(c => ({
            index: c.index,
            start_offset: c.startOffset,
            end_offset: c.endOffset,
            length: c.content.length
          }));
          output.truncated = true;
          output.message = `Showing first 10 of ${chunks.length} chunks. Use rlm_get_chunks to retrieve specific chunks.`;
        }

        return output;
      });
    }
  );

  server.registerTool(
    'rlm_get_chunks',
    {
      title: 'Get Specific Chunks',
      description: `Retrieve content of specific chunks by index.

Use after rlm_decompose_context to get the actual content of chunks you want to process.
You can request multiple chunks at once (up to 50).
You can also pass decompose_id or use_last_decompose to reuse the most recent options.

Note: Uses cached decomposition results for performance.`,
      inputSchema: GetChunksInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: GetChunksInput) => {
      return executeWithTracking('rlm_get_chunks', params as Record<string, unknown>, async () => {
        const session = params.session_id
          ? sessionManager.getSession(params.session_id)
          : sessionManager.getDefaultSession();

        if (!session) {
          throw Errors.sessionNotFound(params.session_id || 'default');
        }

        let resolvedContextId = params.context_id;
        let resolvedStrategy = params.strategy;
        let resolvedOptions = buildDecomposeOptions(params);
        let resolvedDecomposeId: string | undefined;

        if (params.decompose_id) {
          const record = sessionManager.getDecomposition(session.id, params.decompose_id);
          if (!record) {
            throw Errors.invalidInput('decompose_id', 'Unknown decompose_id for this session');
          }
          if (params.context_id !== record.contextId && params.context_id !== 'main') {
            throw Errors.invalidInput('context_id', 'context_id does not match decompose_id');
          }
          resolvedContextId = record.contextId;
          resolvedStrategy = record.strategy;
          resolvedOptions = record.options;
          resolvedDecomposeId = record.id;
        } else if (params.use_last_decompose) {
          const contextExists = session.contexts.has(params.context_id);
          if (contextExists) {
            const record = sessionManager.getLastDecomposition(session.id, params.context_id);
            if (record) {
              resolvedContextId = record.contextId;
              resolvedStrategy = record.strategy;
              resolvedOptions = record.options;
              resolvedDecomposeId = record.id;
            } else if (params.context_id === 'main') {
              const fallback = sessionManager.getMostRecentDecomposition(session.id);
              if (!fallback) {
                throw Errors.invalidInput('use_last_decompose', 'No previous decomposition found for this session');
              }
              resolvedContextId = fallback.contextId;
              resolvedStrategy = fallback.strategy;
              resolvedOptions = fallback.options;
              resolvedDecomposeId = fallback.id;
            } else {
              throw Errors.invalidInput('use_last_decompose', 'No previous decomposition for this context');
            }
          } else {
            const record = sessionManager.getMostRecentDecomposition(session.id);
            if (!record) {
              throw Errors.invalidInput('use_last_decompose', 'No previous decomposition found for this session');
            }
            resolvedContextId = record.contextId;
            resolvedStrategy = record.strategy;
            resolvedOptions = record.options;
            resolvedDecomposeId = record.id;
          }
        }

        const context = session.contexts.get(resolvedContextId);
        if (!context) {
          throw Errors.contextNotFound(resolvedContextId, params.session_id);
        }

        // Use cached decomposition results.
        const allChunks = contextProcessor.decompose(
          context.content, 
          resolvedStrategy, 
          resolvedOptions,
          { contextId: resolvedContextId, sessionId: session?.id || 'default' }
        );

        // Pull the requested chunks only.
        const chunks = params.chunk_indices
          .filter(i => i >= 0 && i < allChunks.length)
          .map(i => ({
            index: i,
            content: allChunks[i].content,
            start_offset: allChunks[i].startOffset,
            end_offset: allChunks[i].endOffset
          }));

        return {
          requested: params.chunk_indices.length,
          returned: chunks.length,
          chunks,
          ...(resolvedDecomposeId ? { decompose_id: resolvedDecomposeId } : {}),
          ...(params.decompose_id || params.use_last_decompose ? { strategy: resolvedStrategy } : {})
        };
      });
    }
  );

  // ============================================
  // Search tools
  // ============================================

  server.registerTool(
    'rlm_search_context',
    {
      title: 'Search Context',
      description: `Search context using regex patterns.

Returns matches with surrounding context and line numbers.
Use this to find relevant sections before reading in detail.
Set compact=true to omit surrounding context and reduce output size.
Note: Results are cached for identical queries within a session.

Security: Patterns are validated to prevent ReDoS attacks.

Examples:
- Pattern: "error|warning" - Find all errors and warnings
- Pattern: "function\\s+\\w+" - Find function definitions
- Pattern: "TODO|FIXME" - Find code comments`,
      inputSchema: SearchContextInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: SearchContextInput) => {
      return executeWithTracking('rlm_search_context', params as Record<string, unknown>, async () => {
        const session = params.session_id
          ? sessionManager.getSession(params.session_id)
          : sessionManager.getDefaultSession();

        if (!session) {
          throw Errors.sessionNotFound(params.session_id || 'default');
        }

        const context = session?.contexts.get(params.context_id);
        
        if (!context) {
          throw Errors.contextNotFound(params.context_id, params.session_id);
        }

        const effectiveContextChars = params.compact ? 0 : params.context_chars;
        const cacheOptions = {
          pattern: params.pattern,
          flags: params.flags,
          context_chars: effectiveContextChars,
          max_results: params.max_results,
          include_line_numbers: params.include_line_numbers,
          compact: params.compact
        };
        const contentHash = chunkCache.createContentHash(context.content);
        const cached = queryCache.get(
          session.id,
          params.context_id,
          'search',
          cacheOptions,
          contentHash
        );

        if (cached) {
          return {
            ...cached,
            cache_hit: true
          };
        }

        // Use the sync version to avoid async complexity.
        const matches = contextProcessor.searchSync(context.content, params.pattern, {
          flags: params.flags,
          contextChars: effectiveContextChars,
          maxResults: params.max_results,
          includeLineNumbers: params.include_line_numbers
        });

        const outputMatches = params.compact
          ? matches.map(({ match, index, lineNumber, groups }) => ({
              match,
              index,
              lineNumber,
              ...(groups && groups.length > 0 ? { groups } : {})
            }))
          : matches;

        const output = {
          pattern: params.pattern,
          total_matches: matches.length,
          matches: outputMatches
        };

        queryCache.set(
          session.id,
          params.context_id,
          'search',
          cacheOptions,
          contentHash,
          output
        );

        return {
          ...output,
          cache_hit: false
        };
      });
    }
  );

  server.registerTool(
    'rlm_find_all',
    {
      title: 'Find All Occurrences',
      description: `Find all occurrences of a substring (faster than regex for simple searches).

Returns character offsets of all matches.
Note: Results are cached for identical queries within a session.`,
      inputSchema: FindAllInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: FindAllInput) => {
      return executeWithTracking('rlm_find_all', params as Record<string, unknown>, async () => {
        const session = params.session_id
          ? sessionManager.getSession(params.session_id)
          : sessionManager.getDefaultSession();

        if (!session) {
          throw Errors.sessionNotFound(params.session_id || 'default');
        }

        const context = session?.contexts.get(params.context_id);
        
        if (!context) {
          throw Errors.contextNotFound(params.context_id, params.session_id);
        }

        const cacheOptions = {
          substring: params.substring,
          case_sensitive: params.case_sensitive
        };
        const contentHash = chunkCache.createContentHash(context.content);
        const cached = queryCache.get(
          session.id,
          params.context_id,
          'find_all',
          cacheOptions,
          contentHash
        );

        if (cached) {
          return {
            ...cached,
            cache_hit: true
          };
        }

        const indices = contextProcessor.findAll(
          context.content,
          params.substring,
          params.case_sensitive
        );

        const output = {
          substring: params.substring,
          case_sensitive: params.case_sensitive,
          count: indices.length,
          offsets: indices
        };

        queryCache.set(
          session.id,
          params.context_id,
          'find_all',
          cacheOptions,
          contentHash,
          output
        );

        return {
          ...output,
          cache_hit: false
        };
      });
    }
  );

  server.registerTool(
    'rlm_rank_chunks',
    {
      title: 'Rank Chunks',
      description: `Rank chunks using lexical BM25 scoring.

Use this to retrieve the most relevant chunks for a query without regex matching.
For CJK text, set tokenizer="cjk_bigrams" or keep tokenizer="auto".
You can also pass decompose_id or use_last_decompose to reuse the most recent options.
Note: Results are cached for identical queries within a session.`,
      inputSchema: RankChunksInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: RankChunksInput) => {
      return executeWithTracking('rlm_rank_chunks', params as Record<string, unknown>, async () => {
        const session = params.session_id
          ? sessionManager.getSession(params.session_id)
          : sessionManager.getDefaultSession();

        if (!session) {
          throw Errors.sessionNotFound(params.session_id || 'default');
        }

        let resolvedContextId = params.context_id;
        let resolvedStrategy = params.strategy;
        let resolvedOptions = buildDecomposeOptions(params);
        let resolvedDecomposeId: string | undefined;

        if (params.decompose_id) {
          const record = sessionManager.getDecomposition(session.id, params.decompose_id);
          if (!record) {
            throw Errors.invalidInput('decompose_id', 'Unknown decompose_id for this session');
          }
          if (params.context_id !== record.contextId && params.context_id !== 'main') {
            throw Errors.invalidInput('context_id', 'context_id does not match decompose_id');
          }
          resolvedContextId = record.contextId;
          resolvedStrategy = record.strategy;
          resolvedOptions = record.options;
          resolvedDecomposeId = record.id;
        } else if (params.use_last_decompose) {
          const contextExists = session.contexts.has(params.context_id);
          if (contextExists) {
            const record = sessionManager.getLastDecomposition(session.id, params.context_id);
            if (record) {
              resolvedContextId = record.contextId;
              resolvedStrategy = record.strategy;
              resolvedOptions = record.options;
              resolvedDecomposeId = record.id;
            } else if (params.context_id === 'main') {
              const fallback = sessionManager.getMostRecentDecomposition(session.id);
              if (!fallback) {
                throw Errors.invalidInput('use_last_decompose', 'No previous decomposition found for this session');
              }
              resolvedContextId = fallback.contextId;
              resolvedStrategy = fallback.strategy;
              resolvedOptions = fallback.options;
              resolvedDecomposeId = fallback.id;
            } else {
              throw Errors.invalidInput('use_last_decompose', 'No previous decomposition for this context');
            }
          } else {
            const record = sessionManager.getMostRecentDecomposition(session.id);
            if (!record) {
              throw Errors.invalidInput('use_last_decompose', 'No previous decomposition found for this session');
            }
            resolvedContextId = record.contextId;
            resolvedStrategy = record.strategy;
            resolvedOptions = record.options;
            resolvedDecomposeId = record.id;
          }
        }

        const context = session.contexts.get(resolvedContextId);
        if (!context) {
          throw Errors.contextNotFound(resolvedContextId, params.session_id);
        }

        const cacheOptions = {
          query: params.query,
          top_k: params.top_k,
          min_score: params.min_score,
          include_content: params.include_content,
          tokenizer: params.tokenizer,
          strategy: resolvedStrategy,
          chunk_size: resolvedOptions.chunkSize,
          overlap: resolvedOptions.overlap,
          lines_per_chunk: resolvedOptions.linesPerChunk,
          tokens_per_chunk: resolvedOptions.tokensPerChunk,
          token_overlap: resolvedOptions.tokenOverlap,
          merge_empty_sections: resolvedOptions.mergeEmptySections,
          min_section_length: resolvedOptions.minSectionLength,
          model: resolvedOptions.model,
          encoding: resolvedOptions.encoding,
          pattern: resolvedOptions.pattern
        };
        const contentHash = chunkCache.createContentHash(context.content);
        const cached = queryCache.get(
          session.id,
          resolvedContextId,
          'rank_chunks',
          cacheOptions,
          contentHash
        );

        if (cached) {
          return {
            ...cached,
            cache_hit: true
          };
        }

        const chunks = contextProcessor.decompose(
          context.content,
          resolvedStrategy,
          resolvedOptions,
          { contextId: resolvedContextId, sessionId: session.id }
        );

        const indexEntry = chunkIndex.getOrBuildIndex(
          resolvedContextId,
          session.id,
          resolvedStrategy,
          {
            ...resolvedOptions,
            tokenizer: params.tokenizer
          },
          context.content,
          chunks
        );

        const ranked = chunkIndex.rank(
          indexEntry,
          params.query,
          params.top_k,
          params.min_score,
          params.tokenizer
        );
        const results = ranked.map((item) => {
          const chunk = chunks[item.index];
          const meta = chunkIndex.getChunkMetadata(indexEntry, item.index);

          return {
            index: item.index,
            score: item.score,
            start_offset: meta?.startOffset ?? chunk.startOffset,
            end_offset: meta?.endOffset ?? chunk.endOffset,
            length: meta?.length ?? chunk.content.length,
            ...(chunk.metadata || {}),
            ...(params.include_content ? { content: chunk.content } : {})
          };
        });

        const output = {
          query: params.query,
          total_chunks: chunks.length,
          returned: results.length,
          results,
          ...(resolvedDecomposeId ? { decompose_id: resolvedDecomposeId } : {}),
          ...(params.decompose_id || params.use_last_decompose ? { strategy: resolvedStrategy } : {})
        };

        queryCache.set(
          session.id,
          resolvedContextId,
          'rank_chunks',
          cacheOptions,
          contentHash,
          output
        );

        return {
          ...output,
          cache_hit: false
        };
      });
    }
  );

  // ============================================
  // REPL / code execution tools
  // ============================================

  server.registerTool(
    'rlm_execute_code',
    {
      title: 'Execute Code',
      description: `Execute JavaScript code in the session's secure REPL environment.

Security: Code runs in vm2 sandbox with memory limits and timeout protection.

Available functions:
- print(...args) - Output text
- getContext(id) - Get context content
- getContextMetadata(id) - Get context metadata
- len(str), slice(str,s,e), split(str,sep), join(arr,sep)
- search(pattern,text,flags), findAll(pattern,text), replace(text,pattern,repl)
- range(start,end,step), map(arr,fn), filter(arr,fn), reduce(arr,fn,init)
- setVar(name,value), getVar(name), listVars()
- setAnswer(content,ready), getAnswer(), appendAnswer(content)
- JSON.parse(), JSON.stringify()
- Math utilities (sum, avg, etc.)

Use this for custom data manipulation and aggregation.`,
      inputSchema: ExecuteCodeInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (params: ExecuteCodeInput) => {
      return executeWithTracking('rlm_execute_code', { ...params, code: `[${params.code.length} chars]` }, async () => {
        const sessionId = params.session_id || 'default';
        const result = await sessionManager.executeCode(sessionId, params.code);

        return {
          success: !result.error,
          output: result.output,
          error: result.error,
          duration_ms: result.durationMs
        };
      });
    }
  );

  server.registerTool(
    'rlm_set_variable',
    {
      title: 'Set Variable',
      description: `Store a variable in the session for later use.

Use this to save intermediate results during RLM processing.`,
      inputSchema: SetVariableInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: SetVariableInput) => {
      return executeWithTracking('rlm_set_variable', { name: params.name }, async () => {
        const sessionId = params.session_id || 'default';
        sessionManager.setVariable(sessionId, params.name, params.value);

        return { success: true, name: params.name };
      });
    }
  );

  server.registerTool(
    'rlm_get_variable',
    {
      title: 'Get Variable',
      description: `Retrieve a variable from the session.`,
      inputSchema: GetVariableInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: GetVariableInput) => {
      return executeWithTracking('rlm_get_variable', params as Record<string, unknown>, async () => {
        const sessionId = params.session_id || 'default';
        const value = sessionManager.getVariable(sessionId, params.name);

        if (value === undefined) {
          return { name: params.name, found: false };
        }

        return {
          name: params.name,
          found: true,
          value
        };
      });
    }
  );

  // ============================================
  // Answer management tools
  // ============================================

  server.registerTool(
    'rlm_set_answer',
    {
      title: 'Set Answer',
      description: `Set or update the answer for the current RLM task.

Call this to build up your answer incrementally:
- ready=false: Store partial/intermediate answer
- ready=true: Mark answer as complete/final

The answer can be retrieved later with rlm_get_answer.`,
      inputSchema: SetAnswerInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: SetAnswerInput) => {
      return executeWithTracking('rlm_set_answer', { ready: params.ready, contentLength: params.content.length }, async () => {
        const sessionId = params.session_id || 'default';
        sessionManager.setVariable(sessionId, 'answer', {
          content: params.content,
          ready: params.ready
        });

        return {
          success: true,
          ready: params.ready,
          content_length: params.content.length
        };
      });
    }
  );

  server.registerTool(
    'rlm_get_answer',
    {
      title: 'Get Answer',
      description: `Get the current answer state.

Returns the content and whether it's marked as ready/complete.`,
      inputSchema: GetAnswerInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: GetAnswerInput) => {
      return executeWithTracking('rlm_get_answer', params as Record<string, unknown>, async () => {
        const sessionId = params.session_id || 'default';
        const answer = sessionManager.getVariable(sessionId, 'answer') as 
          { content: string; ready: boolean } | undefined;

        return answer || { content: '', ready: false };
      });
    }
  );

  // ============================================
  // Session management tools
  // ============================================

  server.registerTool(
    'rlm_create_session',
    {
      title: 'Create Session',
      description: `Create a new isolated RLM session.

Use this when you need multiple independent processing contexts.
Most use cases can use the default session.`,
      inputSchema: CreateSessionInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (_params: CreateSessionInput) => {
      return executeWithTracking('rlm_create_session', {}, async () => {
        const session = sessionManager.createSession();

        return {
          session_id: session.id,
          created_at: session.createdAt.toISOString()
        };
      });
    }
  );

  server.registerTool(
    'rlm_get_session_info',
    {
      title: 'Get Session Info',
      description: `Get information about a session including loaded contexts and variables.`,
      inputSchema: GetSessionInfoInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: GetSessionInfoInput) => {
      return executeWithTracking('rlm_get_session_info', params as Record<string, unknown>, async () => {
        const session = params.session_id
          ? sessionManager.getSession(params.session_id)
          : sessionManager.getDefaultSession();

        if (!session) {
          throw Errors.sessionNotFound(params.session_id || 'default');
        }

        return {
          session_id: session.id,
          created_at: session.createdAt.toISOString(),
          last_activity: session.lastActivityAt.toISOString(),
          contexts: Array.from(session.contexts.entries()).map(([id, ctx]) => ({
            id,
            length: ctx.metadata.length,
            structure: ctx.metadata.structure
          })),
          variables: Array.from(session.variables.keys()),
          execution_count: session.executionHistory.length
        };
      });
    }
  );

  server.registerTool(
    'rlm_clear_session',
    {
      title: 'Clear Session',
      description: `Clear all data from a session (contexts, variables, history).`,
      inputSchema: ClearSessionInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: ClearSessionInput) => {
      return executeWithTracking('rlm_clear_session', params as Record<string, unknown>, async () => {
        const sessionId = params.session_id || 'default';
        sessionManager.clearSession(sessionId);

        return { success: true, session_id: sessionId };
      });
    }
  );

  // ============================================
  // Utility tools
  // ============================================

  server.registerTool(
    'rlm_suggest_strategy',
    {
      title: 'Suggest Decomposition Strategy',
      description: `Get a suggested decomposition strategy based on the context's structure.

Analyzes the content type and size to recommend the best chunking approach.`,
      inputSchema: SuggestStrategyInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: SuggestStrategyInput) => {
      return executeWithTracking('rlm_suggest_strategy', params as Record<string, unknown>, async () => {
        const session = params.session_id
          ? sessionManager.getSession(params.session_id)
          : sessionManager.getDefaultSession();

        if (!session) {
          throw Errors.sessionNotFound(params.session_id || 'default');
        }

        const context = session?.contexts.get(params.context_id);
        
        if (!context) {
          throw Errors.contextNotFound(params.context_id, params.session_id);
        }

        const suggestion = contextProcessor.suggestStrategy(
          context.content,
          context.metadata.structure
        );

        return {
          context_id: params.context_id,
          structure: context.metadata.structure,
          ...suggestion
        };
      });
    }
  );

  server.registerTool(
    'rlm_get_statistics',
    {
      title: 'Get Context Statistics',
      description: `Get detailed statistics about a context.

Returns length, line/word/sentence/paragraph counts, and averages.`,
      inputSchema: GetStatisticsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: GetStatisticsInput) => {
      return executeWithTracking('rlm_get_statistics', params as Record<string, unknown>, async () => {
        const session = params.session_id
          ? sessionManager.getSession(params.session_id)
          : sessionManager.getDefaultSession();

        if (!session) {
          throw Errors.sessionNotFound(params.session_id || 'default');
        }

        const context = session?.contexts.get(params.context_id);
        
        if (!context) {
          throw Errors.contextNotFound(params.context_id, params.session_id);
        }

        const stats = contextProcessor.getStatistics(context.content);

        return {
          context_id: params.context_id,
          ...stats
        };
      });
    }
  );

  // ============================================
  // Performance and metrics tools
  // ============================================

  server.registerTool(
    'rlm_get_metrics',
    {
      title: 'Get Server Metrics',
      description: `Get server performance metrics and statistics.

Returns:
- Uptime
- Tool call counts
- Cache statistics
- Session statistics
- Performance histograms`,
      inputSchema: GetMetricsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (_params: GetMetricsInput) => {
      return executeWithTracking('rlm_get_metrics', {}, async () => {
        return {
          server: metrics.getAll(),
          cache: chunkCache.getStats(),
          query_cache: queryCache.getStats(),
          index: chunkIndex.getStats(),
          sessions: sessionManager.getStats()
        };
      });
    }
  );
}
