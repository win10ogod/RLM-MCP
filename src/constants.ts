/**
 * RLM MCP Server Constants
 * Centralized configuration constants.
 */

import fs from 'node:fs';
import path from 'node:path';

// ===========================================
// Server Info
// ===========================================
export const SERVER_NAME = 'rlm-mcp-server';
export const SERVER_VERSION = '2.4.0';

// ===========================================
// Response Limits
// ===========================================
export const CHARACTER_LIMIT = 100000;        // Max response size
export const MAX_REPL_OUTPUT = 50000;         // Max REPL output per execution

// ===========================================
// Context Limits
// ===========================================
export const MAX_CONTEXT_PREVIEW = 5000;      // Default preview length
export const MAX_SEARCH_RESULTS = 500;        // Max search results

// ===========================================
// Chunking Defaults
// ===========================================
export const DEFAULT_CHUNK_SIZE = 10000;      // Characters per chunk
export const DEFAULT_OVERLAP = 200;           // Overlap between chunks
export const DEFAULT_LINES_PER_CHUNK = 100;   // Lines per chunk
export const DEFAULT_TOKENS_PER_CHUNK = 2000; // Tokens per chunk
export const DEFAULT_TOKEN_OVERLAP = 200;     // Token overlap between chunks

// ===========================================
// Code Execution
// ===========================================
export const CODE_EXECUTION_TIMEOUT_MS = 30000;  // 30 seconds

// ===========================================
// Session Management
// ===========================================
export const SESSION_TIMEOUT_MS = 3600000;    // 1 hour
export const MAX_SESSIONS = 100;              // Max concurrent sessions

// ===========================================
// Resource Limits
// ===========================================
export const RESOURCE_LIMITS = {
  // Max size of a single context (100MB)
  MAX_CONTEXT_SIZE: 100 * 1024 * 1024,
  
  // Total memory limit per session (500MB)
  MAX_SESSION_MEMORY: 500 * 1024 * 1024,
  
  // Max variables per session
  MAX_VARIABLES_PER_SESSION: 1000,
  
  // Max size per variable (10MB)
  MAX_VARIABLE_SIZE: 10 * 1024 * 1024,
  
  // Max execution history entries
  MAX_EXECUTION_HISTORY: 100,
  
  // Max chunks per decomposition
  MAX_CHUNKS: 10000,
  
  // Max contexts per session
  MAX_CONTEXTS_PER_SESSION: 50,
};

// ===========================================
// Sandbox Limits
// ===========================================
export const SANDBOX_LIMITS = {
  // VM memory limit (128MB)
  MEMORY_LIMIT_MB: 128,
  
  // Execution timeout (30 seconds)
  TIMEOUT_MS: 30000,
  
  // Disabled features
  ALLOW_EVAL: false,
  ALLOW_WASM: false,
};

// ===========================================
// Regex Limits
// ===========================================
export const REGEX_LIMITS = {
  // Max pattern length
  MAX_PATTERN_LENGTH: 500,
  
  // Execution timeout
  MAX_EXECUTION_TIME_MS: 1000,
  
  // Max matches
  MAX_MATCHES: 10000,
};

// ===========================================
// Cache Configuration
// ===========================================
export const CACHE_CONFIG = {
  // Max cache entries
  MAX_ENTRIES: 100,
  
  // Max cache size (100MB)
  MAX_SIZE_BYTES: 100 * 1024 * 1024,
  
  // Cache TTL (1 hour)
  TTL_MS: 3600000,
};

// ===========================================
// Storage Configuration
// ===========================================
const parseBoolean = (value?: string): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const DEFAULT_STORAGE_DIR = path.join(process.cwd(), '.rlm_storage');
const STORAGE_DIR_ENV = process.env.RLM_STORAGE_DIR;
const RESOLVED_STORAGE_DIR = STORAGE_DIR_ENV === undefined
  ? DEFAULT_STORAGE_DIR
  : STORAGE_DIR_ENV.trim();

export const STORAGE_CONFIG = {
  // Base directory for persisted contexts (defaults to .rlm_storage)
  BASE_DIR: RESOLVED_STORAGE_DIR,
  
  // Enable persistence when a base directory is configured
  ENABLED: RESOLVED_STORAGE_DIR.length > 0,

  // Optional snapshots of prior context versions
  SNAPSHOTS_ENABLED: parseBoolean(process.env.RLM_STORAGE_SNAPSHOTS),

  // Max snapshots kept per context
  MAX_SNAPSHOTS: parseNumber(process.env.RLM_STORAGE_MAX_SNAPSHOTS, 5),
};

// ===========================================
// Index Configuration
// ===========================================
export const INDEX_CONFIG = {
  // Max in-memory index entries
  MAX_ENTRIES: 50,
  
  // BM25 defaults
  K1: 1.5,
  B: 0.75,
};

// ===========================================
// HTTP Server Configuration
// ===========================================
export const HTTP_CONFIG = {
  // Request body size limit
  MAX_BODY_SIZE: process.env.RLM_HTTP_MAX_BODY_SIZE || '100mb',

  // Max body size in bytes for early rejection
  MAX_BODY_BYTES: parseNumber(process.env.RLM_HTTP_MAX_BODY_BYTES, 100 * 1024 * 1024),
  
  // Default port
  DEFAULT_PORT: parseNumber(process.env.PORT, 3000),

  // Max concurrent HTTP requests
  MAX_CONCURRENT_REQUESTS: parseNumber(process.env.RLM_HTTP_MAX_CONCURRENT_REQUESTS, 8),
  
  // Request timeout
  REQUEST_TIMEOUT_MS: parseNumber(process.env.RLM_HTTP_REQUEST_TIMEOUT_MS, 300000), // 5 minutes

  // HTTPS settings
  HTTPS_ENABLED: parseBoolean(process.env.RLM_HTTPS_ENABLED),
  HTTPS_KEY_PATH: process.env.RLM_HTTPS_KEY_PATH || '',
  HTTPS_CERT_PATH: process.env.RLM_HTTPS_CERT_PATH || '',
  HTTPS_KEY_PASSPHRASE: process.env.RLM_HTTPS_KEY_PASSPHRASE || ''
};

const DEFAULT_HTTPS_KEY_PATH = path.join(process.cwd(), 'certs', 'localhost.key');
const DEFAULT_HTTPS_CERT_PATH = path.join(process.cwd(), 'certs', 'localhost.crt');

if (!HTTP_CONFIG.HTTPS_KEY_PATH && fs.existsSync(DEFAULT_HTTPS_KEY_PATH)) {
  HTTP_CONFIG.HTTPS_KEY_PATH = DEFAULT_HTTPS_KEY_PATH;
}
if (!HTTP_CONFIG.HTTPS_CERT_PATH && fs.existsSync(DEFAULT_HTTPS_CERT_PATH)) {
  HTTP_CONFIG.HTTPS_CERT_PATH = DEFAULT_HTTPS_CERT_PATH;
}

// ===========================================
// Logging Configuration
// ===========================================
export const LOG_CONFIG = {
  // Default log level
  DEFAULT_LEVEL: 'info',
  
  // Emit JSON log lines
  JSON_FORMAT: true,
  
  // Include stack traces in error logs
  INCLUDE_STACK_TRACE: true,
};
