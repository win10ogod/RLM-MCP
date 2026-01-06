/**
 * RLM MCP Server - Security utilities
 *
 * Provides input validation and ReDoS defenses.
 */

import { Errors, RLMError, ErrorCode } from '../errors/index.js';

/**
 * Regex validation limits.
 */
export const REGEX_LIMITS = {
  MAX_PATTERN_LENGTH: 500,
  MAX_EXECUTION_TIME_MS: 1000,
  MAX_MATCHES: 10000,
};

/**
 * Regex patterns that can trigger ReDoS behavior.
 */
const DANGEROUS_PATTERNS = [
  // Nested quantifiers
  /(\+\+|\*\*|\?\?)/,
  // Nested groups with quantifiers
  /\([^)]*[\+\*][^)]*\)[\+\*]/,
  // Excessive alternations
  /\([^|)]*\|[^|)]*\|[^|)]*\|[^|)]*\|/,
  // Catastrophic backtracking candidates
  /\([^)]*\.\*[^)]*\)\+/,
  /\([^)]*\.\+[^)]*\)\+/,
];

/**
 * Validate a regex pattern for safety.
 */
export function validateRegexPattern(pattern: string): { 
  valid: boolean; 
  error?: string;
  warnings?: string[];
} {
  const warnings: string[] = [];
  
  // Enforce max length.
  if (pattern.length > REGEX_LIMITS.MAX_PATTERN_LENGTH) {
    return { 
      valid: false, 
      error: `Pattern too long (max ${REGEX_LIMITS.MAX_PATTERN_LENGTH} characters)` 
    };
  }
  
  // Reject empty patterns.
  if (pattern.trim().length === 0) {
    return { valid: false, error: 'Empty pattern' };
  }
  
  // Reject known dangerous patterns.
  for (const dangerous of DANGEROUS_PATTERNS) {
    if (dangerous.test(pattern)) {
      return { 
        valid: false, 
        error: 'Potentially dangerous pattern (ReDoS risk)' 
      };
    }
  }
  
  // Warn on many optional groups.
  const optionalGroups = (pattern.match(/\([^)]*\)\?/g) || []).length;
  if (optionalGroups > 5) {
    warnings.push('High number of optional groups may cause performance issues');
  }
  
  // Warn on many alternations.
  const alternations = (pattern.match(/\|/g) || []).length;
  if (alternations > 10) {
    warnings.push('High number of alternations may cause performance issues');
  }
  
  // Ensure the regex compiles.
  try {
    new RegExp(pattern);
  } catch (e) {
    return { 
      valid: false, 
      error: `Invalid regex syntax: ${(e as Error).message}` 
    };
  }
  
  return { 
    valid: true, 
    warnings: warnings.length > 0 ? warnings : undefined 
  };
}

/**
 * Execute a regex search with timeout and match limits.
 */
export async function safeRegexSearch(
  pattern: string,
  text: string,
  options: {
    flags?: string;
    timeoutMs?: number;
    maxMatches?: number;
  } = {}
): Promise<RegExpMatchArray[]> {
  const {
    flags = 'g',
    timeoutMs = REGEX_LIMITS.MAX_EXECUTION_TIME_MS,
    maxMatches = REGEX_LIMITS.MAX_MATCHES
  } = options;
  
  // Validate the pattern before execution.
  const validation = validateRegexPattern(pattern);
  if (!validation.valid) {
    throw Errors.invalidRegex(pattern, validation.error!);
  }
  
  return new Promise((resolve, reject) => {
    const results: RegExpMatchArray[] = [];
    const startTime = Date.now();
    
    // Timeout guard.
    const timer = setTimeout(() => {
      reject(Errors.regexTimeout(pattern, timeoutMs));
    }, timeoutMs);
    
    try {
      const regex = new RegExp(pattern, flags);
      let match: RegExpExecArray | null;
      let lastIndex = -1;
      
      while ((match = regex.exec(text)) !== null) {
        // Prevent infinite loops on zero-length matches.
        if (regex.lastIndex === lastIndex) {
          regex.lastIndex++;
          continue;
        }
        lastIndex = regex.lastIndex;
        
        results.push(match);
        
        // Enforce match limit.
        if (results.length >= maxMatches) {
          break;
        }
        
        // Periodically check for timeout.
        if (Date.now() - startTime > timeoutMs) {
          clearTimeout(timer);
          reject(Errors.regexTimeout(pattern, timeoutMs));
          return;
        }
        
        // Non-global patterns match once.
        if (!flags.includes('g')) break;
      }
      
      clearTimeout(timer);
      resolve(results);
    } catch (e) {
      clearTimeout(timer);
      reject(Errors.invalidRegex(pattern, (e as Error).message));
    }
  });
}

/**
 * Execute a regex replacement with validation.
 */
export function safeRegexReplace(
  text: string,
  pattern: string,
  replacement: string,
  flags: string = 'g'
): string {
  const validation = validateRegexPattern(pattern);
  if (!validation.valid) {
    throw Errors.invalidRegex(pattern, validation.error!);
  }
  
  // Limit replacement length.
  if (replacement.length > 10000) {
    throw Errors.invalidInput('replacement', 'Replacement string too long');
  }
  
  try {
    const regex = new RegExp(pattern, flags);
    return text.replace(regex, replacement);
  } catch (e) {
    throw Errors.invalidRegex(pattern, (e as Error).message);
  }
}

/**
 * Sanitize input by removing control characters.
 */
export function sanitizeInput(input: string): string {
  // Allow newlines and tabs, strip other control characters.
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Validate a context ID.
 */
export function validateContextId(contextId: string): { valid: boolean; error?: string } {
  if (!contextId || contextId.trim().length === 0) {
    return { valid: false, error: 'Context ID is required' };
  }
  
  if (contextId.length > 100) {
    return { valid: false, error: 'Context ID too long (max 100 characters)' };
  }
  
  // Only allow letters, numbers, underscores, and hyphens.
  if (!/^[a-zA-Z0-9_-]+$/.test(contextId)) {
    return { valid: false, error: 'Context ID can only contain letters, numbers, underscores and hyphens' };
  }
  
  return { valid: true };
}

/**
 * Validate a variable name.
 */
export function validateVariableName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: 'Variable name is required' };
  }
  
  if (name.length > 100) {
    return { valid: false, error: 'Variable name too long (max 100 characters)' };
  }
  
  // Must start with a letter or underscore.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return { valid: false, error: 'Invalid variable name format' };
  }
  
  // Disallow reserved names.
  const reserved = ['__proto__', 'constructor', 'prototype'];
  if (reserved.includes(name)) {
    return { valid: false, error: 'Reserved variable name' };
  }
  
  return { valid: true };
}

/**
 * Estimate string memory usage in bytes.
 */
export function estimateStringMemory(str: string): number {
  // JavaScript strings are UTF-16: 2 bytes per character, plus object overhead.
  return str.length * 2 + 40;
}

/**
 * Estimate object memory usage in bytes.
 */
export function estimateObjectMemory(obj: unknown): number {
  if (obj === null || obj === undefined) return 0;
  
  if (typeof obj === 'string') {
    return estimateStringMemory(obj);
  }
  
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return 8;
  }
  
  if (Array.isArray(obj)) {
    return obj.reduce((sum, item) => sum + estimateObjectMemory(item), 40);
  }
  
  if (typeof obj === 'object') {
    let size = 40; // Base object overhead.
    for (const [key, value] of Object.entries(obj)) {
      size += estimateStringMemory(key) + estimateObjectMemory(value);
    }
    return size;
  }
  
  return 8; // Fallback for unsupported types.
}

/**
 * Deep-freeze an object to prevent mutation.
 */
export function deepFreeze<T extends object>(obj: T): T {
  Object.freeze(obj);
  
  for (const key of Object.keys(obj)) {
    const value = (obj as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  }
  
  return obj;
}
