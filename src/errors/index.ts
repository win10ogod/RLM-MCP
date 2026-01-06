/**
 * RLM MCP Server - Structured error handling
 *
 * Provides consistent error types and codes for diagnostics.
 */

import type { CallToolResult, TextContent } from '@modelcontextprotocol/sdk/types.js';

/**
 * Error code enumeration
 */
export enum ErrorCode {
  // Context errors (1xxx)
  CONTEXT_NOT_FOUND = 1001,
  CONTEXT_TOO_LARGE = 1002,
  INVALID_CONTEXT_ID = 1003,
  CONTEXT_ALREADY_EXISTS = 1004,
  
  // Session errors (2xxx)
  SESSION_NOT_FOUND = 2001,
  SESSION_EXPIRED = 2002,
  MAX_SESSIONS_REACHED = 2003,
  SESSION_MEMORY_EXCEEDED = 2004,
  
  // Execution errors (3xxx)
  EXECUTION_TIMEOUT = 3001,
  EXECUTION_FAILED = 3002,
  INVALID_CODE = 3003,
  SANDBOX_ERROR = 3004,
  
  // Search errors (4xxx)
  INVALID_REGEX = 4001,
  REGEX_TIMEOUT = 4002,
  REDOS_DETECTED = 4003,
  
  // Resource errors (5xxx)
  MEMORY_LIMIT_EXCEEDED = 5001,
  VARIABLE_LIMIT_EXCEEDED = 5002,
  CHUNK_LIMIT_EXCEEDED = 5003,
  OUTPUT_LIMIT_EXCEEDED = 5004,
  
  // Validation errors (6xxx)
  INVALID_INPUT = 6001,
  MISSING_REQUIRED_FIELD = 6002,
  VALUE_OUT_OF_RANGE = 6003,
  
  // System errors (9xxx)
  INTERNAL_ERROR = 9001,
  NOT_IMPLEMENTED = 9002,
}

/**
 * HTTP status mapping for error codes
 */
export const ErrorHttpStatus: Record<ErrorCode, number> = {
  [ErrorCode.CONTEXT_NOT_FOUND]: 404,
  [ErrorCode.CONTEXT_TOO_LARGE]: 413,
  [ErrorCode.INVALID_CONTEXT_ID]: 400,
  [ErrorCode.CONTEXT_ALREADY_EXISTS]: 409,
  
  [ErrorCode.SESSION_NOT_FOUND]: 404,
  [ErrorCode.SESSION_EXPIRED]: 410,
  [ErrorCode.MAX_SESSIONS_REACHED]: 503,
  [ErrorCode.SESSION_MEMORY_EXCEEDED]: 507,
  
  [ErrorCode.EXECUTION_TIMEOUT]: 408,
  [ErrorCode.EXECUTION_FAILED]: 500,
  [ErrorCode.INVALID_CODE]: 400,
  [ErrorCode.SANDBOX_ERROR]: 500,
  
  [ErrorCode.INVALID_REGEX]: 400,
  [ErrorCode.REGEX_TIMEOUT]: 408,
  [ErrorCode.REDOS_DETECTED]: 400,
  
  [ErrorCode.MEMORY_LIMIT_EXCEEDED]: 507,
  [ErrorCode.VARIABLE_LIMIT_EXCEEDED]: 507,
  [ErrorCode.CHUNK_LIMIT_EXCEEDED]: 413,
  [ErrorCode.OUTPUT_LIMIT_EXCEEDED]: 413,
  
  [ErrorCode.INVALID_INPUT]: 400,
  [ErrorCode.MISSING_REQUIRED_FIELD]: 400,
  [ErrorCode.VALUE_OUT_OF_RANGE]: 400,
  
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.NOT_IMPLEMENTED]: 501,
};

/**
 * RLM-specific error type
 */
export class RLMError extends Error {
  public readonly timestamp: Date;
  public readonly traceId?: string;
  
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    traceId?: string
  ) {
    super(message);
    this.name = 'RLMError';
    this.timestamp = new Date();
    this.traceId = traceId;
    
    // Preserve the prototype chain for instanceof checks.
    Object.setPrototypeOf(this, RLMError.prototype);
  }
  
  /**
   * HTTP status code for this error.
   */
  get httpStatus(): number {
    return ErrorHttpStatus[this.code] || 500;
  }
  
  /**
   * Serialize error details to JSON.
   */
  toJSON(): Record<string, unknown> {
    return {
      error: true,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp.toISOString(),
      traceId: this.traceId
    };
  }
  
  /**
   * Convert to the MCP tool response shape.
   */
  toMCPResponse(): CallToolResult {
    const content: TextContent[] = [{
      type: 'text',
      text: JSON.stringify(this.toJSON(), null, 2)
    }];

    return {
      content,
      isError: true
    };
  }
  
  /**
   * Wrap an unknown error as an RLMError.
   */
  static fromError(error: unknown, traceId?: string): RLMError {
    if (error instanceof RLMError) {
      return error;
    }
    
    if (error instanceof Error) {
      return new RLMError(
        ErrorCode.INTERNAL_ERROR,
        error.message,
        { originalError: error.name, stack: error.stack },
        traceId
      );
    }
    
    return new RLMError(
      ErrorCode.INTERNAL_ERROR,
      String(error),
      undefined,
      traceId
    );
  }
}

/**
 * Helper factory functions for common errors.
 */
export const Errors = {
  contextNotFound: (contextId: string, sessionId?: string) =>
    new RLMError(ErrorCode.CONTEXT_NOT_FOUND, `Context "${contextId}" not found`, { contextId, sessionId }),
  
  contextTooLarge: (size: number, maxSize: number) =>
    new RLMError(ErrorCode.CONTEXT_TOO_LARGE, `Context too large: ${size} bytes (max ${maxSize})`, { size, maxSize }),
  
  sessionNotFound: (sessionId: string) =>
    new RLMError(ErrorCode.SESSION_NOT_FOUND, `Session "${sessionId}" not found`, { sessionId }),
  
  sessionMemoryExceeded: (used: number, limit: number) =>
    new RLMError(ErrorCode.SESSION_MEMORY_EXCEEDED, `Session memory limit exceeded`, { used, limit }),
  
  executionTimeout: (timeoutMs: number) =>
    new RLMError(ErrorCode.EXECUTION_TIMEOUT, `Code execution timeout (${timeoutMs}ms)`, { timeoutMs }),
  
  executionFailed: (message: string) =>
    new RLMError(ErrorCode.EXECUTION_FAILED, `Code execution failed: ${message}`, { reason: message }),
  
  sandboxError: (message: string) =>
    new RLMError(ErrorCode.SANDBOX_ERROR, `Sandbox error: ${message}`, { reason: message }),
  
  invalidRegex: (pattern: string, reason: string) =>
    new RLMError(ErrorCode.INVALID_REGEX, `Invalid regex pattern: ${reason}`, { pattern, reason }),
  
  regexTimeout: (pattern: string, timeoutMs: number) =>
    new RLMError(ErrorCode.REGEX_TIMEOUT, `Regex execution timeout`, { pattern, timeoutMs }),
  
  redosDetected: (pattern: string) =>
    new RLMError(ErrorCode.REDOS_DETECTED, `Potentially dangerous regex pattern (ReDoS risk)`, { pattern }),
  
  variableLimitExceeded: (count: number, limit: number) =>
    new RLMError(ErrorCode.VARIABLE_LIMIT_EXCEEDED, `Variable limit exceeded`, { count, limit }),
  
  chunkLimitExceeded: (count: number, limit: number) =>
    new RLMError(ErrorCode.CHUNK_LIMIT_EXCEEDED, `Too many chunks generated`, { count, limit }),
  
  invalidInput: (field: string, reason: string) =>
    new RLMError(ErrorCode.INVALID_INPUT, `Invalid input for ${field}: ${reason}`, { field, reason }),
};
