/**
 * RLM MCP Server Type Definitions
 * Recursive Language Model types and interfaces
 * 
 * This server provides tools for MCP clients to implement RLM patterns.
 * The client's LLM performs the recursive reasoning - this server provides
 * the infrastructure (REPL, context management, decomposition).
 */

/**
 * Context item stored in a session
 */
export interface ContextItem {
  id: string;
  content: string;
  metadata: ContextMetadata;
  createdAt: Date;
}

/**
 * Context metadata
 */
export interface ContextMetadata {
  length: number;
  lineCount: number;
  wordCount: number;
  structure: StructureType;
  encoding?: string;
}

/**
 * Detected structure type
 */
export enum StructureType {
  PLAIN_TEXT = 'plain_text',
  JSON = 'json',
  CSV = 'csv',
  CODE = 'code',
  MARKDOWN = 'markdown',
  XML = 'xml',
  LOG = 'log',
  MIXED = 'mixed'
}

/**
 * REPL Session state
 */
export interface REPLSession {
  id: string;
  contexts: Map<string, ContextItem>;
  variables: Map<string, unknown>;
  executionHistory: ExecutionRecord[];
  createdAt: Date;
  lastActivityAt: Date;
}

/**
 * Code execution record
 */
export interface ExecutionRecord {
  id: string;
  code: string;
  output: string;
  error?: string;
  executedAt: Date;
  durationMs: number;
}

/**
 * Chunk result from decomposition
 */
export interface Chunk {
  index: number;
  content: string;
  startOffset: number;
  endOffset: number;
  metadata?: Record<string, unknown>;
}

/**
 * Search match result
 */
export interface SearchMatch {
  match: string;
  index: number;
  lineNumber: number;
  context: string;
  groups?: string[];
}

/**
 * Decomposition strategy
 */
export enum DecompositionStrategy {
  FIXED_SIZE = 'fixed_size',
  BY_LINES = 'by_lines',
  BY_PARAGRAPHS = 'by_paragraphs',
  BY_SECTIONS = 'by_sections',
  BY_REGEX = 'by_regex',
  BY_SENTENCES = 'by_sentences',
  BY_TOKENS = 'by_tokens'
}

/**
 * Response format enum
 */
export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json'
}

/**
 * Answer state for RLM processing
 */
export interface AnswerState {
  content: string;
  ready: boolean;
  confidence?: number;
  sources?: string[];
}
