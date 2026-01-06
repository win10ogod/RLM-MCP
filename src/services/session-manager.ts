/**
 * Session Manager - v2.4
 * REPL session manager using a vm2 sandbox.
 */

import { VM, VMScript } from 'vm2';
import {
  REPLSession,
  ContextItem,
  ContextMetadata,
  StructureType,
  ExecutionRecord,
  DecompositionOptions,
  DecompositionRecord
} from '../types.js';
import {
  SESSION_TIMEOUT_MS,
  MAX_SESSIONS,
  MAX_REPL_OUTPUT,
  RESOURCE_LIMITS,
  SANDBOX_LIMITS
} from '../constants.js';
import { RLMError, Errors, ErrorCode } from '../errors/index.js';
import { logger } from '../utils/logger.js';
import { metrics, MetricNames } from '../utils/metrics.js';
import { 
  validateContextId, 
  validateVariableName, 
  estimateStringMemory,
  estimateObjectMemory 
} from '../utils/security.js';
import { chunkCache } from './chunk-cache.js';
import { chunkIndex } from './chunk-index.js';
import { contextStorage } from './context-storage.js';
import { queryCache } from './query-cache.js';

export class SessionManager {
  private sessions: Map<string, REPLSession> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start the cleanup scheduler.
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000); // Check every minute.
    
    logger.info('SessionManager initialized');
  }

  /**
   * Create a new session.
   */
  createSession(): REPLSession {
    // Enforce session count limits.
    if (this.sessions.size >= MAX_SESSIONS) {
      this.cleanupOldestSession();
    }

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const session: REPLSession = {
      id: sessionId,
      contexts: new Map(),
      variables: new Map(),
      executionHistory: [],
      decompositions: new Map(),
      lastDecomposeByContext: new Map(),
      createdAt: new Date(),
      lastActivityAt: new Date()
    };

    // Initialize default variables.
    session.variables.set('answer', { content: '', ready: false });

    this.sessions.set(sessionId, session);
    
    metrics.increment(MetricNames.SESSIONS_CREATED);
    metrics.gauge(MetricNames.ACTIVE_SESSIONS, this.sessions.size);
    logger.sessionCreated(sessionId);
    
    return session;
  }

  /**
   * Retrieve a session by ID.
   */
  getSession(sessionId: string): REPLSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = new Date();
    }
    return session;
  }

  /**
   * Get or create the default session.
   */
  getDefaultSession(): REPLSession {
    const defaultId = 'default';
    let session = this.sessions.get(defaultId);
    
    if (!session) {
      session = {
        id: defaultId,
        contexts: new Map(),
        variables: new Map(),
        executionHistory: [],
        decompositions: new Map(),
        lastDecomposeByContext: new Map(),
        createdAt: new Date(),
        lastActivityAt: new Date()
      };
      session.variables.set('answer', { content: '', ready: false });
      this.sessions.set(defaultId, session);
      
      metrics.increment(MetricNames.SESSIONS_CREATED);
      metrics.gauge(MetricNames.ACTIVE_SESSIONS, this.sessions.size);
    }
    
    session.lastActivityAt = new Date();
    return session;
  }

  /**
   * Estimate memory usage for a session.
   */
  private calculateSessionMemory(session: REPLSession): number {
    let total = 0;
    
    // Account for context content.
    for (const ctx of session.contexts.values()) {
      total += estimateStringMemory(ctx.content);
    }
    
    // Account for variables.
    for (const value of session.variables.values()) {
      total += estimateObjectMemory(value);
    }
    
    return total;
  }

  /**
   * Load a context into a session.
   */
  loadContext(
    sessionId: string,
    contextId: string,
    content: string
  ): ContextItem {
    const timer = metrics.startTimer(MetricNames.LOAD_CONTEXT_DURATION_MS);
    
    try {
      // Validate context ID.
      const validation = validateContextId(contextId);
      if (!validation.valid) {
        throw Errors.invalidInput('context_id', validation.error!);
      }
      
      // Enforce content size limits.
      if (content.length > RESOURCE_LIMITS.MAX_CONTEXT_SIZE) {
        throw Errors.contextTooLarge(content.length, RESOURCE_LIMITS.MAX_CONTEXT_SIZE);
      }
      
      const session = this.getSession(sessionId) || this.getDefaultSession();
      
      // Enforce context count limits.
      if (session.contexts.size >= RESOURCE_LIMITS.MAX_CONTEXTS_PER_SESSION) {
        throw new RLMError(
          ErrorCode.VARIABLE_LIMIT_EXCEEDED,
          `Maximum contexts per session reached (${RESOURCE_LIMITS.MAX_CONTEXTS_PER_SESSION})`
        );
      }
      
      // Compute projected memory usage.
      const existingContext = session.contexts.get(contextId);
      const existingSize = existingContext ? estimateStringMemory(existingContext.content) : 0;
      const newSize = estimateStringMemory(content);
      const currentMemory = this.calculateSessionMemory(session);
      const projectedMemory = currentMemory - existingSize + newSize;
      
      if (projectedMemory > RESOURCE_LIMITS.MAX_SESSION_MEMORY) {
        throw Errors.sessionMemoryExceeded(projectedMemory, RESOURCE_LIMITS.MAX_SESSION_MEMORY);
      }
      
      const metadata = this.analyzeContent(content);
      
      const contextItem: ContextItem = {
        id: contextId,
        content,
        metadata,
        createdAt: new Date()
      };

      // Invalidate cache if overwriting an existing context.
      if (existingContext) {
        if (contextStorage.isSnapshotsEnabled()) {
          contextStorage.saveSnapshot(
            session.id,
            contextId,
            existingContext.content,
            existingContext.metadata,
            existingContext.createdAt,
            'overwrite'
          );
        }
        contextStorage.clearChunkMetadata(session.id, contextId);
        chunkCache.invalidateContext(contextId, session.id);
        chunkIndex.invalidateContext(contextId, session.id);
        queryCache.invalidateContext(contextId, session.id);
      }

      session.contexts.set(contextId, contextItem);
      
      metrics.increment(MetricNames.CONTEXTS_LOADED);
      metrics.gauge(MetricNames.TOTAL_MEMORY_BYTES, this.calculateSessionMemory(session));
      
      logger.info('Context loaded', { 
        sessionId: session.id, 
        contextId, 
        size: content.length,
        structure: metadata.structure 
      });

      if (contextStorage.isEnabled()) {
        contextStorage.saveContext(session.id, contextId, content, metadata, contextItem.createdAt);
      }
      
      return contextItem;
    } finally {
      timer.stop();
    }
  }

  /**
   * Append or prepend content to an existing context
   */
  appendContext(
    sessionId: string,
    contextId: string,
    content: string,
    options: { mode?: 'append' | 'prepend'; createIfMissing?: boolean } = {}
  ): ContextItem {
    const timer = metrics.startTimer(MetricNames.APPEND_CONTEXT_DURATION_MS);

    try {
      const validation = validateContextId(contextId);
      if (!validation.valid) {
        throw Errors.invalidInput('context_id', validation.error!);
      }

      const session = this.getSession(sessionId) || this.getDefaultSession();
      const existingContext = session.contexts.get(contextId);

      if (!existingContext) {
        if (options.createIfMissing === false) {
          throw Errors.contextNotFound(contextId, sessionId);
        }
        return this.loadContext(session.id, contextId, content);
      }

      const mode = options.mode || 'append';
      const combinedContent = mode === 'prepend'
        ? content + existingContext.content
        : existingContext.content + content;

      if (combinedContent.length > RESOURCE_LIMITS.MAX_CONTEXT_SIZE) {
        throw Errors.contextTooLarge(combinedContent.length, RESOURCE_LIMITS.MAX_CONTEXT_SIZE);
      }

      const existingSize = estimateStringMemory(existingContext.content);
      const newSize = estimateStringMemory(combinedContent);
      const currentMemory = this.calculateSessionMemory(session);
      const projectedMemory = currentMemory - existingSize + newSize;

      if (projectedMemory > RESOURCE_LIMITS.MAX_SESSION_MEMORY) {
        throw Errors.sessionMemoryExceeded(projectedMemory, RESOURCE_LIMITS.MAX_SESSION_MEMORY);
      }

      const metadata = this.analyzeContent(combinedContent);

      const contextItem: ContextItem = {
        ...existingContext,
        content: combinedContent,
        metadata
      };

      if (contextStorage.isSnapshotsEnabled()) {
        contextStorage.saveSnapshot(
          session.id,
          contextId,
          existingContext.content,
          existingContext.metadata,
          existingContext.createdAt,
          mode
        );
      }

      contextStorage.clearChunkMetadata(session.id, contextId);
      chunkCache.invalidateContext(contextId, session.id);
      chunkIndex.invalidateContext(contextId, session.id);
      queryCache.invalidateContext(contextId, session.id);
      session.contexts.set(contextId, contextItem);
      
      metrics.increment(MetricNames.CONTEXTS_APPENDED);
      metrics.gauge(MetricNames.TOTAL_MEMORY_BYTES, this.calculateSessionMemory(session));

      logger.info('Context updated', {
        sessionId: session.id,
        contextId,
        size: combinedContent.length,
        mode
      });

      if (contextStorage.isEnabled()) {
        contextStorage.saveContext(session.id, contextId, combinedContent, metadata, contextItem.createdAt);
      }

      return contextItem;
    } finally {
      timer.stop();
    }
  }

  /**
   * Load a context from storage into memory.
   */
  loadContextFromStorage(sessionId: string, contextId: string): ContextItem {
    const stored = contextStorage.loadContext(sessionId, contextId);
    if (!stored) {
      throw Errors.contextNotFound(contextId, sessionId);
    }

    const session = this.getSession(sessionId) || this.getDefaultSession();
    const contextItem = this.loadContext(session.id, contextId, stored.content);
    metrics.increment(MetricNames.CONTEXTS_LOADED_FROM_STORAGE);
    return contextItem;
  }

  /**
   * Unload a context from memory while keeping persisted storage.
   */
  unloadContext(sessionId: string, contextId: string): boolean {
    if (!contextStorage.isEnabled()) {
      throw Errors.invalidInput(
        'storage',
        'Storage is disabled. Set RLM_STORAGE_DIR or leave it unset to use the default .rlm_storage directory.'
      );
    }

    const session = this.getSession(sessionId);
    if (!session) return false;

    const existingContext = session.contexts.get(contextId);
    if (!existingContext) return false;

    if (contextStorage.isEnabled()) {
      contextStorage.saveContext(session.id, contextId, existingContext.content, existingContext.metadata, existingContext.createdAt);
    }

    chunkCache.invalidateContext(contextId, session.id);
    chunkIndex.invalidateContext(contextId, session.id);
    queryCache.invalidateContext(contextId, session.id);
    session.contexts.delete(contextId);

    metrics.increment(MetricNames.CONTEXTS_UNLOADED);
    metrics.gauge(MetricNames.TOTAL_MEMORY_BYTES, this.calculateSessionMemory(session));

    return true;
  }

  /**
   * Analyze content structure and basic stats.
   */
  analyzeContent(content: string): ContextMetadata {
    const length = content.length;
    const lines = content.split('\n');
    const lineCount = lines.length;
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

    // Detect structure type.
    let structure = StructureType.PLAIN_TEXT;
    const trimmed = content.trim();
    
    // JSON detection.
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        JSON.parse(trimmed);
        structure = StructureType.JSON;
      } catch {
        // Not valid JSON.
      }
    }
    
    // XML detection.
    if (structure === StructureType.PLAIN_TEXT && 
        trimmed.startsWith('<') && trimmed.includes('</')) {
      structure = StructureType.XML;
    }
    
    // CSV detection.
    if (structure === StructureType.PLAIN_TEXT && lineCount > 1) {
      const firstLineCommas = (lines[0].match(/,/g) || []).length;
      if (firstLineCommas >= 2) {
        const consistentCommas = lines.slice(1, 10).every(
          line => line.trim() === '' || 
                  Math.abs((line.match(/,/g) || []).length - firstLineCommas) <= 1
        );
        if (consistentCommas) {
          structure = StructureType.CSV;
        }
      }
    }
    
    // Markdown detection.
    if (structure === StructureType.PLAIN_TEXT &&
        (/^#{1,6}\s/m.test(trimmed) || 
         trimmed.includes('```') ||
         /^\s*[-*+]\s/m.test(trimmed))) {
      structure = StructureType.MARKDOWN;
    }
    
    // Code detection.
    if (structure === StructureType.PLAIN_TEXT &&
        /^(import|export|const|let|var|function|class|def|if|for|while|public|private)\s/m.test(trimmed)) {
      structure = StructureType.CODE;
    }
    
    // Log detection.
    if (structure === StructureType.PLAIN_TEXT &&
        /^\d{4}[-/]\d{2}[-/]\d{2}[T\s]\d{2}:\d{2}/m.test(trimmed)) {
      structure = StructureType.LOG;
    }

    return {
      length,
      lineCount,
      wordCount,
      structure
    };
  }

  /**
   * Get a context by ID.
   */
  getContext(sessionId: string, contextId: string): ContextItem | undefined {
    const session = this.getSession(sessionId);
    return session?.contexts.get(contextId);
  }

  /**
   * List contexts in a session.
   */
  listContexts(sessionId: string): Array<{ id: string; metadata: ContextMetadata }> {
    const session = this.getSession(sessionId);
    if (!session) return [];

    return Array.from(session.contexts.entries()).map(([id, ctx]) => ({
      id,
      metadata: ctx.metadata
    }));
  }

  /**
   * Store a variable in the session.
   */
  setVariable(sessionId: string, name: string, value: unknown): void {
    // Validate variable name.
    const validation = validateVariableName(name);
    if (!validation.valid) {
      throw Errors.invalidInput('variable_name', validation.error!);
    }
    
    const session = this.getSession(sessionId) || this.getDefaultSession();
    
    // Enforce variable count limits.
    if (!session.variables.has(name) && 
        session.variables.size >= RESOURCE_LIMITS.MAX_VARIABLES_PER_SESSION) {
      throw Errors.variableLimitExceeded(
        session.variables.size, 
        RESOURCE_LIMITS.MAX_VARIABLES_PER_SESSION
      );
    }
    
    // Enforce variable size limits.
    const valueSize = estimateObjectMemory(value);
    if (valueSize > RESOURCE_LIMITS.MAX_VARIABLE_SIZE) {
      throw new RLMError(
        ErrorCode.VARIABLE_LIMIT_EXCEEDED,
        `Variable too large (${valueSize} bytes, max ${RESOURCE_LIMITS.MAX_VARIABLE_SIZE})`
      );
    }
    
    session.variables.set(name, value);
  }

  storeDecomposition(
    sessionId: string,
    contextId: string,
    strategy: DecompositionRecord['strategy'],
    options: DecompositionOptions
  ): DecompositionRecord {
    const session = this.getSession(sessionId) || this.getDefaultSession();
    const record: DecompositionRecord = {
      id: `decompose_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      contextId,
      strategy,
      options,
      createdAt: new Date()
    };

    session.decompositions.set(record.id, record);
    session.lastDecomposeByContext.set(contextId, record.id);

    return record;
  }

  getDecomposition(sessionId: string, decomposeId: string): DecompositionRecord | null {
    const session = this.getSession(sessionId);
    if (!session) return null;
    return session.decompositions.get(decomposeId) || null;
  }

  getLastDecomposition(sessionId: string, contextId: string): DecompositionRecord | null {
    const session = this.getSession(sessionId);
    if (!session) return null;
    const id = session.lastDecomposeByContext.get(contextId);
    if (!id) return null;
    return session.decompositions.get(id) || null;
  }

  getMostRecentDecomposition(sessionId: string): DecompositionRecord | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    let latest: DecompositionRecord | null = null;
    for (const record of session.decompositions.values()) {
      if (!latest || record.createdAt.getTime() > latest.createdAt.getTime()) {
        latest = record;
      }
    }

    return latest;
  }

  /**
   * Retrieve a variable from the session.
   */
  getVariable(sessionId: string, name: string): unknown {
    const session = this.getSession(sessionId);
    return session?.variables.get(name);
  }

  /**
   * Execute code in the vm2 sandbox.
   */
  async executeCode(sessionId: string, code: string): Promise<ExecutionRecord> {
    const session = this.getSession(sessionId) || this.getDefaultSession();
    const startTime = Date.now();
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const traceId = logger.startToolCall('executeCode', { sessionId, codeLength: code.length });
    
    const outputBuffer: string[] = [];
    
    metrics.increment(MetricNames.CODE_EXECUTIONS);

    try {
      // Create the sandbox environment.
      const sandbox = this.createSandbox(session, outputBuffer);
      
      // Execute with vm2.
      const vm = new VM({
        timeout: SANDBOX_LIMITS.TIMEOUT_MS,
        sandbox,
        eval: SANDBOX_LIMITS.ALLOW_EVAL,
        wasm: SANDBOX_LIMITS.ALLOW_WASM,
        fixAsync: true,
      });
      
      // Compile and run the script.
      const script = new VMScript(code);
      vm.run(script);
      
      let output = outputBuffer.join('\n');
      if (output.length > MAX_REPL_OUTPUT) {
        output = output.slice(0, MAX_REPL_OUTPUT) + 
          `\n... [Output truncated at ${MAX_REPL_OUTPUT} characters]`;
      }

      const record: ExecutionRecord = {
        id: executionId,
        code,
        output,
        executedAt: new Date(),
        durationMs: Date.now() - startTime
      };

      // Cap execution history size.
      if (session.executionHistory.length >= RESOURCE_LIMITS.MAX_EXECUTION_HISTORY) {
        session.executionHistory.shift();
      }
      session.executionHistory.push(record);
      
      metrics.recordDuration(MetricNames.CODE_EXECUTION_DURATION_MS, record.durationMs);
      logger.endToolCall(traceId, true, { durationMs: record.durationMs });
      
      return record;

    } catch (error) {
      metrics.increment(MetricNames.CODE_EXECUTION_ERRORS);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check for timeout errors.
      const isTimeout = errorMessage.includes('Script execution timed out');
      
      const record: ExecutionRecord = {
        id: executionId,
        code,
        output: '',
        error: isTimeout 
          ? `Execution timeout (${SANDBOX_LIMITS.TIMEOUT_MS}ms)` 
          : errorMessage,
        executedAt: new Date(),
        durationMs: Date.now() - startTime
      };

      if (session.executionHistory.length >= RESOURCE_LIMITS.MAX_EXECUTION_HISTORY) {
        session.executionHistory.shift();
      }
      session.executionHistory.push(record);
      
      logger.endToolCall(traceId, false, { error: errorMessage });
      
      return record;
    }
  }

  /**
   * Build the sandbox environment for code execution.
   */
  private createSandbox(session: REPLSession, outputBuffer: string[]): Record<string, unknown> {
    // Output helper.
    const print = (...args: unknown[]) => {
      const line = args.map(a => 
        typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
      ).join(' ');
      outputBuffer.push(line);
    };
    
    return {
      // Output.
      print,
      console: {
        log: print,
        info: print,
        warn: print,
        error: print,
      },

      // Context access.
      getContext: (contextId: string): string | undefined => {
        return session.contexts.get(contextId)?.content;
      },
      getContextMetadata: (contextId: string) => {
        return session.contexts.get(contextId)?.metadata;
      },
      listContexts: () => {
        return Array.from(session.contexts.keys());
      },

      // String helpers.
      len: (obj: string | unknown[]): number => {
        return typeof obj === 'string' || Array.isArray(obj) ? obj.length : 0;
      },
      slice: (str: string, start?: number, end?: number): string => {
        return str.slice(start, end);
      },
      split: (str: string, sep: string = '\n'): string[] => {
        return str.split(sep);
      },
      join: (arr: string[], sep: string = ''): string => {
        return arr.join(sep);
      },
      trim: (str: string): string => str.trim(),
      lower: (str: string): string => str.toLowerCase(),
      upper: (str: string): string => str.toUpperCase(),
      includes: (str: string, search: string): boolean => str.includes(search),
      startsWith: (str: string, search: string): boolean => str.startsWith(search),
      endsWith: (str: string, search: string): boolean => str.endsWith(search),
      padStart: (str: string, len: number, pad?: string): string => str.padStart(len, pad),
      padEnd: (str: string, len: number, pad?: string): string => str.padEnd(len, pad),

      // Regex helpers (best-effort safety).
      search: (pattern: string, text: string, flags: string = 'g'): string[] => {
        try {
          const regex = new RegExp(pattern, flags);
          return text.match(regex) || [];
        } catch {
          return [];
        }
      },
      findAll: (pattern: string, text: string): Array<{ match: string; index: number }> => {
        try {
          const regex = new RegExp(pattern, 'g');
          const results: Array<{ match: string; index: number }> = [];
          let match;
          let count = 0;
          const maxMatches = 1000;
          
          while ((match = regex.exec(text)) !== null && count < maxMatches) {
            results.push({ match: match[0], index: match.index });
            count++;
            // Prevent infinite loops on zero-length matches.
            if (match[0].length === 0) regex.lastIndex++;
          }
          return results;
        } catch {
          return [];
        }
      },
      replace: (text: string, pattern: string, replacement: string, flags: string = 'g'): string => {
        try {
          return text.replace(new RegExp(pattern, flags), replacement);
        } catch {
          return text;
        }
      },
      test: (pattern: string, text: string): boolean => {
        try {
          return new RegExp(pattern).test(text);
        } catch {
          return false;
        }
      },

      // Array helpers.
      range: (start: number, end?: number, step: number = 1): number[] => {
        if (end === undefined) { end = start; start = 0; }
        const result: number[] = [];
        const maxLength = 10000;
        for (let i = start; i < end && result.length < maxLength; i += step) {
          result.push(i);
        }
        return result;
      },
      map: <T, U>(arr: T[], fn: (item: T, index: number) => U): U[] => arr.map(fn),
      filter: <T>(arr: T[], fn: (item: T) => boolean): T[] => arr.filter(fn),
      reduce: <T, U>(arr: T[], fn: (acc: U, item: T) => U, init: U): U => arr.reduce(fn, init),
      sort: <T>(arr: T[], fn?: (a: T, b: T) => number): T[] => [...arr].sort(fn),
      reverse: <T>(arr: T[]): T[] => [...arr].reverse(),
      unique: <T>(arr: T[]): T[] => [...new Set(arr)],
      flatten: <T>(arr: T[][]): T[] => arr.flat(),
      chunk: <T>(arr: T[], size: number): T[][] => {
        const chunks: T[][] = [];
        const maxChunks = 1000;
        for (let i = 0; i < arr.length && chunks.length < maxChunks; i += size) {
          chunks.push(arr.slice(i, i + size));
        }
        return chunks;
      },
      find: <T>(arr: T[], fn: (item: T) => boolean): T | undefined => arr.find(fn),
      findIndex: <T>(arr: T[], fn: (item: T) => boolean): number => arr.findIndex(fn),
      every: <T>(arr: T[], fn: (item: T) => boolean): boolean => arr.every(fn),
      some: <T>(arr: T[], fn: (item: T) => boolean): boolean => arr.some(fn),
      take: <T>(arr: T[], n: number): T[] => arr.slice(0, n),
      skip: <T>(arr: T[], n: number): T[] => arr.slice(n),
      groupBy: <T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> => {
        const groups: Record<string, T[]> = {};
        for (const item of arr) {
          const key = keyFn(item);
          if (!groups[key]) groups[key] = [];
          groups[key].push(item);
        }
        return groups;
      },

      // Variable management.
      setVar: (name: string, value: unknown): void => {
        try {
          const validation = validateVariableName(name);
          if (validation.valid) {
            session.variables.set(name, value);
          }
        } catch {
          // Ignore errors from invalid variable names.
        }
      },
      getVar: (name: string): unknown => {
        return session.variables.get(name);
      },
      listVars: (): string[] => {
        return Array.from(session.variables.keys());
      },
      deleteVar: (name: string): boolean => {
        return session.variables.delete(name);
      },

      // Answer management.
      setAnswer: (content: string, ready: boolean = false): void => {
        session.variables.set('answer', { content, ready });
      },
      getAnswer: () => {
        return session.variables.get('answer') || { content: '', ready: false };
      },
      appendAnswer: (content: string): void => {
        const current = session.variables.get('answer') as { content: string; ready: boolean } || 
          { content: '', ready: false };
        session.variables.set('answer', { 
          content: current.content + content, 
          ready: current.ready 
        });
      },

      // JSON helpers.
      JSON: {
        parse: (str: string) => {
          try {
            return JSON.parse(str);
          } catch {
            return null;
          }
        },
        stringify: (obj: unknown, indent?: number) => {
          try {
            return JSON.stringify(obj, null, indent);
          } catch {
            return null;
          }
        }
      },

      // Math helpers.
      Math: {
        abs: Math.abs,
        ceil: Math.ceil,
        floor: Math.floor,
        round: Math.round,
        max: Math.max,
        min: Math.min,
        pow: Math.pow,
        sqrt: Math.sqrt,
        random: Math.random,
        PI: Math.PI,
        E: Math.E,
        sum: (arr: number[]): number => arr.reduce((a, b) => a + b, 0),
        avg: (arr: number[]): number => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0,
      },

      // Type checks.
      typeOf: (val: unknown): string => typeof val,
      isArray: Array.isArray,
      isString: (val: unknown): boolean => typeof val === 'string',
      isNumber: (val: unknown): boolean => typeof val === 'number',
      isObject: (val: unknown): boolean => typeof val === 'object' && val !== null && !Array.isArray(val),
      isNull: (val: unknown): boolean => val === null,
      isUndefined: (val: unknown): boolean => val === undefined,
      
      // Object helpers.
      keys: Object.keys,
      values: Object.values,
      entries: Object.entries,
      fromEntries: Object.fromEntries,
      assign: Object.assign,
    };
  }

  /**
   * Delete a session and its data.
   */
  deleteSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Invalidate related cache entries.
      chunkCache.invalidateSession(sessionId);
      chunkIndex.invalidateSession(sessionId);
      queryCache.invalidateSession(sessionId);
      this.sessions.delete(sessionId);
      
      metrics.increment(MetricNames.SESSIONS_DESTROYED);
      metrics.gauge(MetricNames.ACTIVE_SESSIONS, this.sessions.size);
      logger.sessionDestroyed(sessionId, 'manual');
      
      return true;
    }
    return false;
  }

  /**
   * Clear all data from a session.
   */
  clearSession(sessionId: string): void {
    const session = this.getSession(sessionId);
    if (session) {
      // Invalidate related cache entries.
      chunkCache.invalidateSession(sessionId);
      chunkIndex.invalidateSession(sessionId);
      queryCache.invalidateSession(sessionId);
      
      session.contexts.clear();
      session.variables.clear();
      session.variables.set('answer', { content: '', ready: false });
      session.executionHistory = [];
      session.decompositions.clear();
      session.lastDecomposeByContext.clear();
      
      logger.info('Session cleared', { sessionId });
    }
  }

  /**
   * Remove expired sessions.
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [id, session] of this.sessions) {
      if (id !== 'default' && 
          now - session.lastActivityAt.getTime() > SESSION_TIMEOUT_MS) {
        chunkCache.invalidateSession(id);
        chunkIndex.invalidateSession(id);
        queryCache.invalidateSession(id);
        this.sessions.delete(id);
        cleaned++;
        
        metrics.increment(MetricNames.SESSIONS_DESTROYED);
        logger.sessionDestroyed(id, 'expired');
      }
    }
    
    if (cleaned > 0) {
      metrics.gauge(MetricNames.ACTIVE_SESSIONS, this.sessions.size);
      logger.debug('Expired sessions cleaned', { count: cleaned });
    }
  }

  /**
   * Evict the least recently used session.
   */
  private cleanupOldestSession(): void {
    let oldest: { id: string; time: number } | null = null;
    
    for (const [id, session] of this.sessions) {
      if (id === 'default') continue;
      
      const time = session.lastActivityAt.getTime();
      if (!oldest || time < oldest.time) {
        oldest = { id, time };
      }
    }
    
    if (oldest) {
      chunkCache.invalidateSession(oldest.id);
      chunkIndex.invalidateSession(oldest.id);
      queryCache.invalidateSession(oldest.id);
      this.sessions.delete(oldest.id);
      
      metrics.increment(MetricNames.SESSIONS_DESTROYED);
      logger.sessionDestroyed(oldest.id, 'evicted');
    }
  }

  /**
   * Return session-level statistics.
   */
  getStats(): Record<string, unknown> {
    const sessions = Array.from(this.sessions.entries()).map(([id, session]) => ({
      id,
      contexts: session.contexts.size,
      variables: session.variables.size,
      executions: session.executionHistory.length,
      decompositions: session.decompositions.size,
      memory: this.calculateSessionMemory(session),
      createdAt: session.createdAt.toISOString(),
      lastActivity: session.lastActivityAt.toISOString()
    }));
    
    return {
      totalSessions: this.sessions.size,
      sessions
    };
  }

  /**
   * Tear down the session manager.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.sessions.clear();
    chunkCache.clear();
    chunkIndex.clear();
    queryCache.clear();
    logger.info('SessionManager destroyed');
  }
}

// Singleton instance.
export const sessionManager = new SessionManager();
