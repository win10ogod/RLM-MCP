/**
 * Zod schemas for RLM MCP Server tools
 * These tools enable the client's LLM to implement RLM patterns
 */

import { z } from 'zod';
import { DecompositionStrategy } from '../types.js';

// ============================================
// Context Management Tools
// ============================================

/**
 * Load context into session
 */
export const LoadContextInputSchema = z.object({
  context: z.string()
    .min(1, 'Context is required')
    .describe('The text content to load'),
  
  context_id: z.string()
    .min(1)
    .max(100)
    .default('main')
    .describe('Unique identifier for this context (default: "main")'),
  
  session_id: z.string()
    .optional()
    .describe('Session ID. If not provided, uses default session')
}).strict();

export type LoadContextInput = z.infer<typeof LoadContextInputSchema>;

/**
 * Append or prepend content to an existing context
 */
export const AppendContextInputSchema = z.object({
  context_id: z.string()
    .default('main')
    .describe('Context identifier'),

  session_id: z.string()
    .optional()
    .describe('Session ID'),

  content: z.string()
    .min(1, 'Content is required')
    .describe('Content to append or prepend'),

  mode: z.enum(['append', 'prepend'])
    .default('append')
    .describe('Where to add the new content'),

  create_if_missing: z.boolean()
    .default(true)
    .describe('Create the context if it does not exist')
}).strict();

export type AppendContextInput = z.infer<typeof AppendContextInputSchema>;

/**
 * Load context content from storage
 */
export const LoadContextFromStorageInputSchema = z.object({
  context_id: z.string()
    .default('main')
    .describe('Context identifier'),

  session_id: z.string()
    .optional()
    .describe('Session ID')
}).strict();

export type LoadContextFromStorageInput = z.infer<typeof LoadContextFromStorageInputSchema>;

/**
 * Unload a context from memory
 */
export const UnloadContextInputSchema = z.object({
  context_id: z.string()
    .default('main')
    .describe('Context identifier'),

  session_id: z.string()
    .optional()
    .describe('Session ID')
}).strict();

export type UnloadContextInput = z.infer<typeof UnloadContextInputSchema>;

/**
 * Get context info/metadata
 */
export const GetContextInfoInputSchema = z.object({
  context_id: z.string()
    .default('main')
    .describe('Context identifier'),
  
  session_id: z.string()
    .optional()
    .describe('Session ID'),
  
  include_preview: z.boolean()
    .default(true)
    .describe('Include content preview'),
  
  preview_length: z.number()
    .int()
    .min(100)
    .max(10000)
    .default(2000)
    .describe('Preview length in characters')
}).strict();

export type GetContextInfoInput = z.infer<typeof GetContextInfoInputSchema>;

/**
 * Read portion of context
 */
export const ReadContextInputSchema = z.object({
  context_id: z.string()
    .default('main')
    .describe('Context identifier'),
  
  session_id: z.string()
    .optional()
    .describe('Session ID'),
  
  start: z.number()
    .int()
    .min(0)
    .default(0)
    .describe('Start position (character offset or line number)'),
  
  end: z.number()
    .int()
    .optional()
    .describe('End position (exclusive)'),
  
  mode: z.enum(['chars', 'lines'])
    .default('chars')
    .describe('Read by character offsets or line numbers')
}).strict();

export type ReadContextInput = z.infer<typeof ReadContextInputSchema>;

// ============================================
// Decomposition Tools
// ============================================

/**
 * Decompose context into chunks
 */
export const DecomposeContextInputSchema = z.object({
  context_id: z.string()
    .default('main')
    .describe('Context identifier'),
  
  session_id: z.string()
    .optional()
    .describe('Session ID'),
  
  strategy: z.nativeEnum(DecompositionStrategy)
    .default(DecompositionStrategy.FIXED_SIZE)
    .describe('Decomposition strategy'),
  
  chunk_size: z.number()
    .int()
    .min(100)
    .max(200000)
    .default(10000)
    .describe('Chunk size in characters (for fixed_size strategy)'),
  
  overlap: z.number()
    .int()
    .min(0)
    .max(10000)
    .default(200)
    .describe('Overlap between chunks'),
  
  lines_per_chunk: z.number()
    .int()
    .min(1)
    .max(10000)
    .default(100)
    .describe('Lines per chunk (for by_lines strategy)'),

  tokens_per_chunk: z.number()
    .int()
    .min(1)
    .max(200000)
    .default(2000)
    .describe('Tokens per chunk (for by_tokens strategy)'),

  token_overlap: z.number()
    .int()
    .min(0)
    .max(50000)
    .default(200)
    .describe('Token overlap between chunks'),

  merge_empty_sections: z.boolean()
    .default(false)
    .describe('Merge empty markdown sections (for by_sections strategy)'),

  min_section_length: z.number()
    .int()
    .min(0)
    .max(200000)
    .default(0)
    .describe('Minimum markdown section length before merging (for by_sections strategy)'),

  encoding: z.string()
    .optional()
    .describe('Tokenizer encoding name (for by_tokens strategy)'),

  model: z.string()
    .optional()
    .describe('Tokenizer model name (for by_tokens strategy)'),

  pattern: z.string()
    .optional()
    .describe('Regex pattern (for by_regex strategy)'),
  
  return_content: z.boolean()
    .default(false)
    .describe('Include chunk content in response (can be large)')
}).strict();

export type DecomposeContextInput = z.infer<typeof DecomposeContextInputSchema>;

/**
 * Get specific chunk(s)
 */
export const GetChunksInputSchema = z.object({
  context_id: z.string()
    .default('main')
    .describe('Context identifier'),
  
  session_id: z.string()
    .optional()
    .describe('Session ID'),

  decompose_id: z.string()
    .optional()
    .describe('Use options from a previous rlm_decompose_context call'),

  use_last_decompose: z.boolean()
    .default(false)
    .describe('Use the most recent rlm_decompose_context options for this context (falls back to the session\'s most recent decomposition if the context is missing)'),
  
  chunk_indices: z.array(z.number().int().min(0))
    .min(1)
    .max(50)
    .describe('Indices of chunks to retrieve'),

  strategy: z.nativeEnum(DecompositionStrategy)
    .default(DecompositionStrategy.FIXED_SIZE)
    .describe('Same strategy used in decompose'),

  chunk_size: z.number()
    .int()
    .default(10000)
    .describe('Same chunk_size used in decompose'),

  overlap: z.number()
    .int()
    .default(200)
    .describe('Same overlap used in decompose'),

  lines_per_chunk: z.number()
    .int()
    .min(1)
    .max(10000)
    .default(100)
    .describe('Same lines_per_chunk used in decompose'),

  tokens_per_chunk: z.number()
    .int()
    .min(1)
    .max(200000)
    .default(2000)
    .describe('Same tokens_per_chunk used in decompose'),

  token_overlap: z.number()
    .int()
    .min(0)
    .max(50000)
    .default(200)
    .describe('Same token_overlap used in decompose'),

  merge_empty_sections: z.boolean()
    .default(false)
    .describe('Same merge_empty_sections used in decompose'),

  min_section_length: z.number()
    .int()
    .min(0)
    .max(200000)
    .default(0)
    .describe('Same min_section_length used in decompose'),

  encoding: z.string()
    .optional()
    .describe('Same encoding used in decompose'),

  model: z.string()
    .optional()
    .describe('Same model used in decompose'),

  pattern: z.string()
    .optional()
    .describe('Same regex pattern used in decompose')
}).strict();

export type GetChunksInput = z.infer<typeof GetChunksInputSchema>;

// ============================================
// Search Tools
// ============================================

/**
 * Search context with regex
 */
export const SearchContextInputSchema = z.object({
  context_id: z.string()
    .default('main')
    .describe('Context identifier'),
  
  session_id: z.string()
    .optional()
    .describe('Session ID'),
  
  pattern: z.string()
    .min(1)
    .describe('Regex pattern to search for'),
  
  flags: z.string()
    .default('gi')
    .describe('Regex flags (default: gi for global case-insensitive)'),
  
  context_chars: z.number()
    .int()
    .min(0)
    .max(1000)
    .default(100)
    .describe('Characters of surrounding context to include'),

  compact: z.boolean()
    .default(false)
    .describe('Return matches without surrounding context to reduce output size'),
  
  max_results: z.number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe('Maximum results to return'),
  
  include_line_numbers: z.boolean()
    .default(true)
    .describe('Include line numbers in results')
}).strict();

export type SearchContextInput = z.infer<typeof SearchContextInputSchema>;

/**
 * Find all occurrences of substring
 */
export const FindAllInputSchema = z.object({
  context_id: z.string()
    .default('main')
    .describe('Context identifier'),
  
  session_id: z.string()
    .optional()
    .describe('Session ID'),
  
  substring: z.string()
    .min(1)
    .describe('Substring to find'),
  
  case_sensitive: z.boolean()
    .default(false)
    .describe('Case-sensitive search')
}).strict();

export type FindAllInput = z.infer<typeof FindAllInputSchema>;

/**
 * Rank chunks using lexical scoring
 */
export const RankChunksInputSchema = z.object({
  context_id: z.string()
    .default('main')
    .describe('Context identifier'),

  session_id: z.string()
    .optional()
    .describe('Session ID'),

  decompose_id: z.string()
    .optional()
    .describe('Use options from a previous rlm_decompose_context call'),

  use_last_decompose: z.boolean()
    .default(false)
    .describe('Use the most recent rlm_decompose_context options for this context (falls back to the session\'s most recent decomposition if the context is missing)'),

  query: z.string()
    .min(1)
    .describe('Search query for ranking'),

  top_k: z.number()
    .int()
    .min(1)
    .max(200)
    .default(10)
    .describe('Number of chunks to return'),

  min_score: z.number()
    .optional()
    .describe('Minimum BM25 score to include'),

  include_content: z.boolean()
    .default(false)
    .describe('Include chunk content in the response'),

  tokenizer: z.enum(['auto', 'default', 'cjk_bigrams'])
    .default('auto')
    .describe('Tokenizer for BM25 ranking'),

  strategy: z.nativeEnum(DecompositionStrategy)
    .default(DecompositionStrategy.FIXED_SIZE)
    .describe('Same strategy used in decompose'),

  chunk_size: z.number()
    .int()
    .min(100)
    .max(200000)
    .default(10000)
    .describe('Same chunk_size used in decompose'),

  overlap: z.number()
    .int()
    .min(0)
    .max(10000)
    .default(200)
    .describe('Same overlap used in decompose'),

  lines_per_chunk: z.number()
    .int()
    .min(1)
    .max(10000)
    .default(100)
    .describe('Same lines_per_chunk used in decompose'),

  tokens_per_chunk: z.number()
    .int()
    .min(1)
    .max(200000)
    .default(2000)
    .describe('Same tokens_per_chunk used in decompose'),

  token_overlap: z.number()
    .int()
    .min(0)
    .max(50000)
    .default(200)
    .describe('Same token_overlap used in decompose'),

  merge_empty_sections: z.boolean()
    .default(false)
    .describe('Same merge_empty_sections used in decompose'),

  min_section_length: z.number()
    .int()
    .min(0)
    .max(200000)
    .default(0)
    .describe('Same min_section_length used in decompose'),

  encoding: z.string()
    .optional()
    .describe('Same encoding used in decompose'),

  model: z.string()
    .optional()
    .describe('Same model used in decompose'),

  pattern: z.string()
    .optional()
    .describe('Same regex pattern used in decompose')
}).strict();

export type RankChunksInput = z.infer<typeof RankChunksInputSchema>;

// ============================================
// REPL / Code Execution Tools
// ============================================

/**
 * Execute JavaScript code in REPL
 */
export const ExecuteCodeInputSchema = z.object({
  code: z.string()
    .min(1)
    .describe('JavaScript code to execute'),
  
  session_id: z.string()
    .optional()
    .describe('Session ID')
}).strict();

export type ExecuteCodeInput = z.infer<typeof ExecuteCodeInputSchema>;

/**
 * Set variable in session
 */
export const SetVariableInputSchema = z.object({
  name: z.string()
    .min(1)
    .max(100)
    .describe('Variable name'),
  
  value: z.unknown()
    .describe('Variable value (any JSON-serializable value)'),
  
  session_id: z.string()
    .optional()
    .describe('Session ID')
}).strict();

export type SetVariableInput = z.infer<typeof SetVariableInputSchema>;

/**
 * Get variable from session
 */
export const GetVariableInputSchema = z.object({
  name: z.string()
    .min(1)
    .describe('Variable name'),
  
  session_id: z.string()
    .optional()
    .describe('Session ID')
}).strict();

export type GetVariableInput = z.infer<typeof GetVariableInputSchema>;

// ============================================
// Answer Management Tools
// ============================================

/**
 * Set/update answer state
 */
export const SetAnswerInputSchema = z.object({
  content: z.string()
    .describe('Answer content (can be partial or complete)'),
  
  ready: z.boolean()
    .default(false)
    .describe('Mark answer as final/complete'),
  
  session_id: z.string()
    .optional()
    .describe('Session ID')
}).strict();

export type SetAnswerInput = z.infer<typeof SetAnswerInputSchema>;

/**
 * Get current answer state
 */
export const GetAnswerInputSchema = z.object({
  session_id: z.string()
    .optional()
    .describe('Session ID')
}).strict();

export type GetAnswerInput = z.infer<typeof GetAnswerInputSchema>;

// ============================================
// Session Management Tools
// ============================================

/**
 * Create new session
 */
export const CreateSessionInputSchema = z.object({}).strict();

export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;

/**
 * List session info
 */
export const GetSessionInfoInputSchema = z.object({
  session_id: z.string()
    .optional()
    .describe('Session ID (uses default if not provided)')
}).strict();

export type GetSessionInfoInput = z.infer<typeof GetSessionInfoInputSchema>;

/**
 * Clear session data
 */
export const ClearSessionInputSchema = z.object({
  session_id: z.string()
    .optional()
    .describe('Session ID')
}).strict();

export type ClearSessionInput = z.infer<typeof ClearSessionInputSchema>;

// ============================================
// Utility Tools
// ============================================

/**
 * Get decomposition suggestion
 */
export const SuggestStrategyInputSchema = z.object({
  context_id: z.string()
    .default('main')
    .describe('Context identifier'),
  
  session_id: z.string()
    .optional()
    .describe('Session ID')
}).strict();

export type SuggestStrategyInput = z.infer<typeof SuggestStrategyInputSchema>;

/**
 * Get context statistics
 */
export const GetStatisticsInputSchema = z.object({
  context_id: z.string()
    .default('main')
    .describe('Context identifier'),
  
  session_id: z.string()
    .optional()
    .describe('Session ID')
}).strict();

export type GetStatisticsInput = z.infer<typeof GetStatisticsInputSchema>;

/**
 * Get server metrics
 */
export const GetMetricsInputSchema = z.object({}).strict();

export type GetMetricsInput = z.infer<typeof GetMetricsInputSchema>;
