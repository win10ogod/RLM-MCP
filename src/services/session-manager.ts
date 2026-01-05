/**
 * Session Manager
 * Manages REPL sessions with context storage
 */

import {
  REPLSession,
  ContextItem,
  ContextMetadata,
  StructureType,
  ExecutionRecord
} from '../types.js';
import {
  SESSION_TIMEOUT_MS,
  MAX_SESSIONS,
  CODE_EXECUTION_TIMEOUT_MS,
  MAX_REPL_OUTPUT
} from '../constants.js';

export class SessionManager {
  private sessions: Map<string, REPLSession> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000); // Check every minute
  }

  /**
   * Create a new session
   */
  createSession(): REPLSession {
    // Cleanup if too many sessions
    if (this.sessions.size >= MAX_SESSIONS) {
      this.cleanupOldestSession();
    }

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const session: REPLSession = {
      id: sessionId,
      contexts: new Map(),
      variables: new Map(),
      executionHistory: [],
      createdAt: new Date(),
      lastActivityAt: new Date()
    };

    // Initialize default variables
    session.variables.set('answer', { content: '', ready: false });

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): REPLSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = new Date();
    }
    return session;
  }

  /**
   * Get or create default session
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
        createdAt: new Date(),
        lastActivityAt: new Date()
      };
      session.variables.set('answer', { content: '', ready: false });
      this.sessions.set(defaultId, session);
    }
    
    session.lastActivityAt = new Date();
    return session;
  }

  /**
   * Load context into a session
   */
  loadContext(
    sessionId: string,
    contextId: string,
    content: string
  ): ContextItem {
    const session = this.getSession(sessionId) || this.getDefaultSession();
    
    const metadata = this.analyzeContent(content);
    
    const contextItem: ContextItem = {
      id: contextId,
      content,
      metadata,
      createdAt: new Date()
    };

    session.contexts.set(contextId, contextItem);
    return contextItem;
  }

  /**
   * Analyze content structure
   */
  analyzeContent(content: string): ContextMetadata {
    const length = content.length;
    const lines = content.split('\n');
    const lineCount = lines.length;
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

    // Detect structure type
    let structure = StructureType.PLAIN_TEXT;
    const trimmed = content.trim();
    
    // JSON detection
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        JSON.parse(trimmed);
        structure = StructureType.JSON;
      } catch {
        // Not valid JSON
      }
    }
    
    // XML detection
    if (structure === StructureType.PLAIN_TEXT && 
        trimmed.startsWith('<') && trimmed.includes('</')) {
      structure = StructureType.XML;
    }
    
    // CSV detection
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
    
    // Markdown detection
    if (structure === StructureType.PLAIN_TEXT &&
        (/^#{1,6}\s/m.test(trimmed) || 
         trimmed.includes('```') ||
         /^\s*[-*+]\s/m.test(trimmed))) {
      structure = StructureType.MARKDOWN;
    }
    
    // Code detection
    if (structure === StructureType.PLAIN_TEXT &&
        /^(import|export|const|let|var|function|class|def|if|for|while|public|private)\s/m.test(trimmed)) {
      structure = StructureType.CODE;
    }
    
    // Log detection
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
   * Get context from session
   */
  getContext(sessionId: string, contextId: string): ContextItem | undefined {
    const session = this.getSession(sessionId);
    return session?.contexts.get(contextId);
  }

  /**
   * List all contexts in a session
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
   * Set variable in session
   */
  setVariable(sessionId: string, name: string, value: unknown): void {
    const session = this.getSession(sessionId) || this.getDefaultSession();
    session.variables.set(name, value);
  }

  /**
   * Get variable from session
   */
  getVariable(sessionId: string, name: string): unknown {
    const session = this.getSession(sessionId);
    return session?.variables.get(name);
  }

  /**
   * Execute code in session context
   */
  async executeCode(sessionId: string, code: string): Promise<ExecutionRecord> {
    const session = this.getSession(sessionId) || this.getDefaultSession();
    const startTime = Date.now();
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const outputBuffer: string[] = [];

    try {
      // Create sandbox with session context
      const sandbox = this.createSandbox(session, outputBuffer);
      
      // Execute code with timeout
      await this.runWithTimeout(code, sandbox, CODE_EXECUTION_TIMEOUT_MS);
      
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

      session.executionHistory.push(record);
      return record;

    } catch (error) {
      const record: ExecutionRecord = {
        id: executionId,
        code,
        output: '',
        error: error instanceof Error ? error.message : String(error),
        executedAt: new Date(),
        durationMs: Date.now() - startTime
      };

      session.executionHistory.push(record);
      return record;
    }
  }

  /**
   * Create sandbox environment
   */
  private createSandbox(session: REPLSession, outputBuffer: string[]): Record<string, unknown> {
    return {
      // Output
      print: (...args: unknown[]) => {
        outputBuffer.push(args.map(a => 
          typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
        ).join(' '));
      },
      console: {
        log: (...args: unknown[]) => {
          outputBuffer.push(args.map(a => 
            typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
          ).join(' '));
        }
      },

      // Context access
      getContext: (contextId: string): string | undefined => {
        return session.contexts.get(contextId)?.content;
      },
      getContextMetadata: (contextId: string) => {
        return session.contexts.get(contextId)?.metadata;
      },
      listContexts: () => {
        return Array.from(session.contexts.keys());
      },

      // String operations
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

      // Regex operations
      search: (pattern: string, text: string, flags: string = 'g'): string[] => {
        const regex = new RegExp(pattern, flags);
        return text.match(regex) || [];
      },
      findAll: (pattern: string, text: string): Array<{ match: string; index: number }> => {
        const regex = new RegExp(pattern, 'g');
        const results: Array<{ match: string; index: number }> = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
          results.push({ match: match[0], index: match.index });
        }
        return results;
      },
      replace: (text: string, pattern: string, replacement: string, flags: string = 'g'): string => {
        return text.replace(new RegExp(pattern, flags), replacement);
      },

      // Array operations
      range: (start: number, end?: number, step: number = 1): number[] => {
        if (end === undefined) { end = start; start = 0; }
        const result: number[] = [];
        for (let i = start; i < end; i += step) result.push(i);
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
        for (let i = 0; i < arr.length; i += size) {
          chunks.push(arr.slice(i, i + size));
        }
        return chunks;
      },

      // Variable management
      setVar: (name: string, value: unknown): void => {
        session.variables.set(name, value);
      },
      getVar: (name: string): unknown => {
        return session.variables.get(name);
      },
      listVars: (): string[] => {
        return Array.from(session.variables.keys());
      },

      // Answer management
      setAnswer: (content: string, ready: boolean = false): void => {
        session.variables.set('answer', { content, ready });
      },
      getAnswer: () => {
        return session.variables.get('answer') || { content: '', ready: false };
      },

      // JSON utilities
      JSON: {
        parse: JSON.parse,
        stringify: (obj: unknown, indent?: number) => JSON.stringify(obj, null, indent)
      },

      // Math
      Math,

      // Type checking
      typeOf: (val: unknown): string => typeof val,
      isArray: Array.isArray,
      isString: (val: unknown): boolean => typeof val === 'string',
      isNumber: (val: unknown): boolean => typeof val === 'number',
    };
  }

  /**
   * Run code with timeout
   */
  private async runWithTimeout(
    code: string, 
    sandbox: Record<string, unknown>,
    timeoutMs: number
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Execution timeout (${timeoutMs}ms)`));
      }, timeoutMs);

      try {
        const sandboxKeys = Object.keys(sandbox);
        const sandboxValues = Object.values(sandbox);
        
        const wrappedCode = `
          (function(${sandboxKeys.join(', ')}) {
            "use strict";
            ${code}
          })
        `;
        
        const fn = eval(wrappedCode);
        const result = fn(...sandboxValues);
        
        clearTimeout(timeout);
        resolve(result);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Delete session
   */
  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Clear session data
   */
  clearSession(sessionId: string): void {
    const session = this.getSession(sessionId);
    if (session) {
      session.contexts.clear();
      session.variables.clear();
      session.variables.set('answer', { content: '', ready: false });
      session.executionHistory = [];
    }
  }

  /**
   * Cleanup expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (id !== 'default' && 
          now - session.lastActivityAt.getTime() > SESSION_TIMEOUT_MS) {
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Cleanup oldest session
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
      this.sessions.delete(oldest.id);
    }
  }

  /**
   * Destroy manager
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.sessions.clear();
  }
}

// Singleton instance
export const sessionManager = new SessionManager();
