/**
 * RLM MCP Server - Structured logging
 *
 * Emits JSON log lines to stderr (MCP convention).
 */

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

/**
 * Log level ordering for comparisons.
 */
const LOG_LEVEL_VALUE: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3
};

/**
 * Log entry shape.
 */
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  traceId?: string;
  durationMs?: number;
  service: string;
}

/**
 * Tool call trace.
 */
interface ToolTrace {
  traceId: string;
  toolName: string;
  startTime: number;
  params?: Record<string, unknown>;
}

/**
 * Logger implementation.
 */
class Logger {
  private minLevel: LogLevel = LogLevel.INFO;
  private service: string = 'rlm-mcp-server';
  private activeTraces: Map<string, ToolTrace> = new Map();
  
  /**
   * Set the minimum log level.
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }
  
  /**
   * Set the service name for log entries.
   */
  setService(service: string): void {
    this.service = service;
  }
  
  /**
   * Check whether a level should be logged.
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_VALUE[level] >= LOG_LEVEL_VALUE[this.minLevel];
  }
  
  /**
   * Generate a trace ID.
   */
  generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  
  /**
   * Internal log method.
   */
  private log(
    level: LogLevel, 
    message: string, 
    context?: Record<string, unknown>,
    traceId?: string,
    durationMs?: number
  ): void {
    if (!this.shouldLog(level)) return;
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.service,
      ...(context && { context }),
      ...(traceId && { traceId }),
      ...(durationMs !== undefined && { durationMs })
    };
    
    // MCP convention: logs go to stderr.
    console.error(JSON.stringify(entry));
  }
  
  /**
   * Debug-level log.
   */
  debug(message: string, context?: Record<string, unknown>, traceId?: string): void {
    this.log(LogLevel.DEBUG, message, context, traceId);
  }
  
  /**
   * Info-level log.
   */
  info(message: string, context?: Record<string, unknown>, traceId?: string): void {
    this.log(LogLevel.INFO, message, context, traceId);
  }
  
  /**
   * Warn-level log.
   */
  warn(message: string, context?: Record<string, unknown>, traceId?: string): void {
    this.log(LogLevel.WARN, message, context, traceId);
  }
  
  /**
   * Error-level log.
   */
  error(message: string, context?: Record<string, unknown>, traceId?: string): void {
    this.log(LogLevel.ERROR, message, context, traceId);
  }
  
  /**
   * Start tool call tracing.
   */
  startToolCall(toolName: string, params?: Record<string, unknown>): string {
    const traceId = this.generateTraceId();
    const trace: ToolTrace = {
      traceId,
      toolName,
      startTime: Date.now(),
      params
    };
    
    this.activeTraces.set(traceId, trace);
    
    this.info(`Tool call started: ${toolName}`, {
      tool: toolName,
      // Avoid logging large parameters.
      params: this.sanitizeParams(params)
    }, traceId);
    
    return traceId;
  }
  
  /**
   * End tool call tracing.
   */
  endToolCall(traceId: string, success: boolean, result?: Record<string, unknown>): void {
    const trace = this.activeTraces.get(traceId);
    if (!trace) {
      this.warn('Attempted to end unknown trace', { traceId });
      return;
    }
    
    const durationMs = Date.now() - trace.startTime;
    this.activeTraces.delete(traceId);
    
    this.log(
      success ? LogLevel.INFO : LogLevel.ERROR,
      `Tool call ${success ? 'completed' : 'failed'}: ${trace.toolName}`,
      {
        tool: trace.toolName,
        success,
        ...(result && { result: this.sanitizeParams(result) })
      },
      traceId,
      durationMs
    );
  }
  
  /**
   * Record a tool call error.
   */
  toolError(traceId: string, error: Error | string): void {
    const trace = this.activeTraces.get(traceId);
    const durationMs = trace ? Date.now() - trace.startTime : undefined;
    
    if (trace) {
      this.activeTraces.delete(traceId);
    }
    
    this.error(`Tool call error: ${trace?.toolName || 'unknown'}`, {
      tool: trace?.toolName,
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined
    }, traceId);
  }
  
  /**
   * Sanitize parameters to avoid logging oversized data.
   */
  private sanitizeParams(params?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!params) return undefined;
    
    const sanitized: Record<string, unknown> = {};
    const MAX_STRING_LENGTH = 500;
    const MAX_ARRAY_LENGTH = 10;
    
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        sanitized[key] = value.length > MAX_STRING_LENGTH 
          ? `${value.slice(0, MAX_STRING_LENGTH)}... [truncated, ${value.length} chars]`
          : value;
      } else if (Array.isArray(value)) {
        sanitized[key] = value.length > MAX_ARRAY_LENGTH
          ? `[Array of ${value.length} items]`
          : value;
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = '[Object]';
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }
  
  /**
   * Log server startup.
   */
  serverStarted(mode: string, details?: Record<string, unknown>): void {
    this.info('Server started', { mode, ...details });
  }
  
  /**
   * Log server shutdown.
   */
  serverStopped(reason?: string): void {
    this.info('Server stopped', { reason });
  }
  
  /**
   * Session-related logs.
   */
  sessionCreated(sessionId: string): void {
    this.debug('Session created', { sessionId });
  }
  
  sessionDestroyed(sessionId: string, reason?: string): void {
    this.debug('Session destroyed', { sessionId, reason });
  }
  
  /**
   * Performance-related logs.
   */
  performance(operation: string, durationMs: number, details?: Record<string, unknown>): void {
    const level = durationMs > 5000 ? LogLevel.WARN : LogLevel.DEBUG;
    this.log(level, `Performance: ${operation}`, details, undefined, durationMs);
  }
}

// Singleton instance.
export const logger = new Logger();

// Convenience alias.
export const log = logger;
