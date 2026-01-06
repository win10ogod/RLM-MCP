/**
 * RLM MCP Server v2.3
 * Recursive Language Model Infrastructure Server
 * 
 * This server provides tools that enable ANY MCP client's LLM to implement
 * RLM (Recursive Language Model) patterns for processing arbitrarily long contexts.
 * 
 * v2.3 Improvements:
 * - Token-based chunking (tiktoken)
 * - BM25 chunk ranking
 * - Opt-in context persistence
 * - vm2 secure sandbox for code execution
 * - ReDoS protection for regex operations
 * - Chunk caching for performance
 * - Structured error handling
 * - JSON logging
 * - Performance metrics
 * - Resource limits
 * 
 * Key Design Principle:
 * - No external LLM API dependencies
 * - The client's LLM performs the reasoning
 * - This server provides the infrastructure:
 *   - Context storage and management
 *   - Decomposition into chunks
 *   - Search and navigation
 *   - Code execution (REPL)
 *   - State management across turns
 * 
 * Based on the paper "Recursive Language Models" by Zhang, Kraska, and Khattab
 * https://arxiv.org/abs/2512.24601
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { SERVER_NAME, SERVER_VERSION, HTTP_CONFIG } from './constants.js';
import { registerRLMTools } from './tools/rlm-tools.js';
import { sessionManager } from './services/session-manager.js';
import { chunkCache } from './services/chunk-cache.js';
import { chunkIndex } from './services/chunk-index.js';
import { logger, LogLevel } from './utils/logger.js';
import { metrics } from './utils/metrics.js';

/**
 * Create and configure the MCP server
 */
function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });

  // Register all RLM tools
  registerRLMTools(server);

  return server;
}

/**
 * Start server with stdio transport (default)
 */
async function startStdioServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  
  await server.connect(transport);
  logger.serverStarted('stdio', { version: SERVER_VERSION });
}

/**
 * Start server with HTTP transport
 */
async function startHttpServer(port: number = HTTP_CONFIG.DEFAULT_PORT): Promise<void> {
  const app = express();
  app.use(express.json({ limit: HTTP_CONFIG.MAX_BODY_SIZE }));

  // Create a new server instance for each request (stateless)
  app.post('/mcp', async (req, res) => {
    const server = createServer();
    
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    res.on('close', () => {
      transport.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Health check endpoint
  app.get('/health', (_, res) => {
    res.json({
      status: 'ok',
      server: SERVER_NAME,
      version: SERVER_VERSION,
      uptime_ms: metrics.getAll().uptime_ms
    });
  });

  // Server info endpoint
  app.get('/info', (_, res) => {
    res.json({
      name: SERVER_NAME,
      version: SERVER_VERSION,
      description: 'RLM Infrastructure Server - Enables any LLM to process arbitrarily long contexts through recursive decomposition',
      design: 'No external LLM API required - your client LLM performs the reasoning',
      features: [
        'Token-based chunking (tiktoken)',
        'BM25 chunk ranking',
        'Opt-in context persistence',
        'vm2 secure sandbox',
        'ReDoS protection',
        'Chunk caching',
        'Structured logging',
        'Performance metrics',
        'Resource limits'
      ],
      tools: [
        // Context Management
        'rlm_load_context',
        'rlm_append_context',
        'rlm_load_context_from_storage',
        'rlm_get_context_info', 
        'rlm_read_context',
        'rlm_unload_context',
        // Decomposition
        'rlm_decompose_context',
        'rlm_get_chunks',
        // Search
        'rlm_search_context',
        'rlm_find_all',
        'rlm_rank_chunks',
        // Code Execution
        'rlm_execute_code',
        'rlm_set_variable',
        'rlm_get_variable',
        // Answer Management
        'rlm_set_answer',
        'rlm_get_answer',
        // Session Management
        'rlm_create_session',
        'rlm_get_session_info',
        'rlm_clear_session',
        // Utilities
        'rlm_suggest_strategy',
        'rlm_get_statistics',
        'rlm_get_metrics'
      ]
    });
  });

  // Metrics endpoint
  app.get('/metrics', (_, res) => {
    res.json({
      server: metrics.getAll(),
      cache: chunkCache.getStats(),
      index: chunkIndex.getStats(),
      sessions: sessionManager.getStats()
    });
  });

  app.listen(port, () => {
    logger.serverStarted('http', { 
      port, 
      version: SERVER_VERSION,
      endpoints: {
        mcp: `POST http://localhost:${port}/mcp`,
        health: `GET http://localhost:${port}/health`,
        info: `GET http://localhost:${port}/info`,
        metrics: `GET http://localhost:${port}/metrics`
      }
    });
  });
}

/**
 * Print usage instructions
 */
function printUsage(): void {
  console.error(`
${SERVER_NAME} v${SERVER_VERSION}
RLM Infrastructure Server - Enables any LLM to process arbitrarily long contexts

USAGE:
  node dist/index.js [OPTIONS]

OPTIONS:
  --stdio          Run with stdio transport (default)
  --http           Run with HTTP transport
  --port=PORT      HTTP port (default: ${HTTP_CONFIG.DEFAULT_PORT})
  --debug          Enable debug logging
  --help           Show this help message

EXAMPLES:
  node dist/index.js                    # Start with stdio
  node dist/index.js --http             # Start HTTP server on port ${HTTP_CONFIG.DEFAULT_PORT}
  node dist/index.js --http --port=8080 # Start HTTP server on port 8080
  node dist/index.js --debug            # Start with debug logging

MCP CLIENT CONFIG (Claude Desktop):
  {
    "mcpServers": {
      "rlm": {
        "command": "node",
        "args": ["path/to/rlm-mcp-server/dist/index.js"]
      }
    }
  }

v2.3 IMPROVEMENTS:
  - Token-based chunking (tiktoken)
  - BM25 chunk ranking
  - Opt-in context persistence
  - vm2 secure sandbox for code execution
  - ReDoS protection for regex operations  
  - Chunk caching for performance
  - Structured JSON logging
  - Performance metrics
  - Resource limits and memory management

No API keys required - this server provides infrastructure only.
Your client's LLM performs all the reasoning.
`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  // Parse command line arguments
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  // Debug mode
  if (args.includes('--debug')) {
    logger.setLevel(LogLevel.DEBUG);
  }

  const httpMode = args.includes('--http');
  const portArg = args.find(a => a.startsWith('--port='));
  const port = portArg ? parseInt(portArg.split('=')[1], 10) : HTTP_CONFIG.DEFAULT_PORT;

  logger.info(`${SERVER_NAME} v${SERVER_VERSION} starting`, {
    mode: httpMode ? 'http' : 'stdio',
    nodeVersion: process.version,
    platform: process.platform
  });

  // Cleanup on exit
  const cleanup = () => {
    logger.serverStopped('signal');
    sessionManager.destroy();
    chunkCache.clear();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { 
      error: error.message, 
      stack: error.stack 
    });
    cleanup();
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { 
      reason: reason instanceof Error ? reason.message : String(reason) 
    });
  });

  if (httpMode) {
    await startHttpServer(port);
  } else {
    await startStdioServer();
  }
}

// Run the server
main().catch((error) => {
  logger.error('Fatal error', { error: error.message, stack: error.stack });
  process.exit(1);
});
