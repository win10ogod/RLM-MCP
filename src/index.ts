/**
 * RLM MCP Server v2.4
 * Recursive Language Model Infrastructure Server
 * 
 * This server provides tools that enable ANY MCP client's LLM to implement
 * RLM (Recursive Language Model) patterns for processing arbitrarily long contexts.
 * 
 * v2.4 Improvements:
 * - Token-based chunking (tiktoken)
 * - BM25 chunk ranking
 * - Opt-in context persistence
 * - Persisted chunk metadata
 * - Optional context snapshots
 * - HTTP backpressure controls
 * - vm2 secure sandbox for code execution
 * - ReDoS protection for regex operations
 * - Chunk caching for performance
 * - Query result caching
 * - Tutorial resources
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

import fs from 'node:fs';
import https from 'node:https';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Request, type Response, type NextFunction } from 'express';
import { SERVER_NAME, SERVER_VERSION, HTTP_CONFIG } from './constants.js';
import { registerRLMTools } from './tools/rlm-tools.js';
import { registerRLMResources } from './resources/rlm-resources.js';
import { sessionManager } from './services/session-manager.js';
import { chunkCache } from './services/chunk-cache.js';
import { chunkIndex } from './services/chunk-index.js';
import { queryCache } from './services/query-cache.js';
import { getTutorialResourceSummaries } from './services/tutorials.js';
import { logger, LogLevel } from './utils/logger.js';
import { metrics } from './utils/metrics.js';

interface ConcurrencyLimiter {
  tryAcquire: (res: Response) => boolean;
  getActive: () => number;
}

function createConcurrencyLimiter(maxConcurrent: number): ConcurrencyLimiter {
  let active = 0;

  return {
    tryAcquire(res: Response): boolean {
      if (active >= maxConcurrent) {
        return false;
      }

      active += 1;
      let released = false;

      const release = () => {
        if (released) return;
        released = true;
        active = Math.max(0, active - 1);
      };

      res.on('finish', release);
      res.on('close', release);

      return true;
    },
    getActive(): number {
      return active;
    }
  };
}

function getContentLength(req: Request): number | null {
  const header = req.headers['content-length'];
  if (!header) return null;
  const value = Array.isArray(header) ? header[0] : header;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveHttpsOptions(requireHttps: boolean): {
  useHttps: boolean;
  options?: https.ServerOptions;
} {
  const enabled = requireHttps || HTTP_CONFIG.HTTPS_ENABLED;
  if (!enabled) {
    return { useHttps: false };
  }

  const keyPath = HTTP_CONFIG.HTTPS_KEY_PATH;
  const certPath = HTTP_CONFIG.HTTPS_CERT_PATH;

  if (!keyPath || !certPath) {
    const message = 'HTTPS requires RLM_HTTPS_KEY_PATH and RLM_HTTPS_CERT_PATH';
    if (requireHttps) {
      throw new Error(message);
    }
    logger.warn(message, {
      keyPathConfigured: Boolean(keyPath),
      certPathConfigured: Boolean(certPath)
    });
    return { useHttps: false };
  }

  const key = fs.readFileSync(keyPath);
  const cert = fs.readFileSync(certPath);
  const options: https.ServerOptions = { key, cert };

  if (HTTP_CONFIG.HTTPS_KEY_PASSPHRASE) {
    options.passphrase = HTTP_CONFIG.HTTPS_KEY_PASSPHRASE;
  }

  return { useHttps: true, options };
}

function assertHttpsConfig(): void {
  const keyPath = HTTP_CONFIG.HTTPS_KEY_PATH;
  const certPath = HTTP_CONFIG.HTTPS_CERT_PATH;
  const missingEnv: string[] = [];
  const missingFiles: string[] = [];

  if (!keyPath) missingEnv.push('RLM_HTTPS_KEY_PATH');
  if (!certPath) missingEnv.push('RLM_HTTPS_CERT_PATH');

  if (keyPath && !fs.existsSync(keyPath)) missingFiles.push(keyPath);
  if (certPath && !fs.existsSync(certPath)) missingFiles.push(certPath);

  if (missingEnv.length === 0 && missingFiles.length === 0) {
    return;
  }

  logger.error('HTTPS configuration invalid', {
    missing_env: missingEnv,
    missing_files: missingFiles
  });
  console.error('HTTPS requires RLM_HTTPS_KEY_PATH and RLM_HTTPS_CERT_PATH.');
  console.error('Set valid paths or run with --http instead.');
  printUsage();
  process.exit(1);
}

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
  registerRLMResources(server);

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
async function startHttpServer(
  port: number = HTTP_CONFIG.DEFAULT_PORT,
  options: { requireHttps?: boolean } = {}
): Promise<void> {
  const app = express();
  const limiter = createConcurrencyLimiter(HTTP_CONFIG.MAX_CONCURRENT_REQUESTS);
  const httpsConfig = resolveHttpsOptions(Boolean(options.requireHttps));
  const protocol = httpsConfig.useHttps ? 'https' : 'http';

  app.use((req: Request, res: Response, next: NextFunction) => {
    const contentLength = getContentLength(req);
    if (contentLength !== null && contentLength > HTTP_CONFIG.MAX_BODY_BYTES) {
      logger.warn('HTTP request rejected due to size', {
        contentLength,
        maxBytes: HTTP_CONFIG.MAX_BODY_BYTES
      });
      res.status(413).json({
        error: 'Request body too large',
        max_bytes: HTTP_CONFIG.MAX_BODY_BYTES
      });
      return;
    }
    next();
  });
  app.use(express.json({ limit: HTTP_CONFIG.MAX_BODY_SIZE }));

  // Create a new server instance for each request (stateless)
  app.post('/mcp', async (req, res) => {
    if (!limiter.tryAcquire(res)) {
      logger.warn('HTTP request rejected due to concurrency limit', {
        active: limiter.getActive(),
        maxConcurrent: HTTP_CONFIG.MAX_CONCURRENT_REQUESTS
      });
      res.status(429).json({
        error: 'Too many concurrent requests',
        max_concurrent: HTTP_CONFIG.MAX_CONCURRENT_REQUESTS
      });
      return;
    }

    const server = createServer();
    
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    res.on('close', () => {
      transport.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error('HTTP MCP request failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
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
        'Persisted chunk metadata',
        'Context snapshots (opt-in)',
        'HTTP backpressure controls',
        'HTTPS support (TLS)',
        'vm2 secure sandbox',
        'ReDoS protection',
        'Chunk caching',
        'Query result caching',
        'Tutorial resources',
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
      ],
      resources: getTutorialResourceSummaries()
    });
  });

  // Metrics endpoint
  app.get('/metrics', (_, res) => {
    res.json({
      server: metrics.getAll(),
      cache: chunkCache.getStats(),
      query_cache: queryCache.getStats(),
      index: chunkIndex.getStats(),
      sessions: sessionManager.getStats()
    });
  });

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.too.large') {
      res.status(413).json({
        error: 'Request body too large',
        max_bytes: HTTP_CONFIG.MAX_BODY_BYTES
      });
      return;
    }

    next(err as Error);
  });

  const logServer = () => {
    logger.serverStarted(protocol, { 
      port, 
      version: SERVER_VERSION,
      endpoints: {
        mcp: `POST ${protocol}://localhost:${port}/mcp`,
        health: `GET ${protocol}://localhost:${port}/health`,
        info: `GET ${protocol}://localhost:${port}/info`,
        metrics: `GET ${protocol}://localhost:${port}/metrics`
      }
    });
  };

  if (httpsConfig.useHttps && httpsConfig.options) {
    const server = https.createServer(httpsConfig.options, app);
    server.listen(port, logServer);
    return;
  }

  app.listen(port, logServer);
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
  --https          Run with HTTPS transport (requires TLS key/cert)
  --port=PORT      HTTP port (default: ${HTTP_CONFIG.DEFAULT_PORT})
  --debug          Enable debug logging
  --help           Show this help message

EXAMPLES:
  node dist/index.js                    # Start with stdio
  node dist/index.js --http             # Start HTTP server on port ${HTTP_CONFIG.DEFAULT_PORT}
  node dist/index.js --https            # Start HTTPS server on port ${HTTP_CONFIG.DEFAULT_PORT}
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

v2.4 IMPROVEMENTS:
  - Token-based chunking (tiktoken)
  - BM25 chunk ranking
  - Opt-in context persistence
  - Persisted chunk metadata
  - Optional context snapshots
  - HTTP backpressure controls
  - HTTPS support (TLS)
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

  const httpMode = args.includes('--http') || args.includes('--https');
  const requireHttps = args.includes('--https');
  const portArg = args.find(a => a.startsWith('--port='));
  const port = portArg ? parseInt(portArg.split('=')[1], 10) : HTTP_CONFIG.DEFAULT_PORT;

  logger.info(`${SERVER_NAME} v${SERVER_VERSION} starting`, {
    mode: httpMode ? (requireHttps || HTTP_CONFIG.HTTPS_ENABLED ? 'https' : 'http') : 'stdio',
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
    if (requireHttps) {
      assertHttpsConfig();
    }
    await startHttpServer(port, { requireHttps });
  } else {
    await startStdioServer();
  }
}

// Run the server
main().catch((error) => {
  logger.error('Fatal error', { error: error.message, stack: error.stack });
  process.exit(1);
});
