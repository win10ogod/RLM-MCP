import fs from 'node:fs';
import path from 'node:path';
import { STORAGE_CONFIG } from '../constants.js';
import { Errors } from '../errors/index.js';
import { logger } from '../utils/logger.js';
import type { ContextMetadata } from '../types.js';

interface StoredContext {
  content: string;
  metadata: ContextMetadata;
  createdAt: string;
  updatedAt: string;
}

interface StoredContextMetadata {
  metadata: ContextMetadata;
  createdAt: string;
  updatedAt: string;
}

class ContextStorage {
  private baseDir: string = STORAGE_CONFIG.BASE_DIR;

  isEnabled(): boolean {
    return STORAGE_CONFIG.ENABLED && this.baseDir.length > 0;
  }

  saveContext(
    sessionId: string,
    contextId: string,
    content: string,
    metadata: ContextMetadata,
    createdAt?: Date
  ): void {
    if (!this.isEnabled()) return;
    this.ensureSafeId('session_id', sessionId);
    this.ensureSafeId('context_id', contextId);

    const sessionDir = path.join(this.baseDir, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });

    const contentPath = this.getContentPath(sessionDir, contextId);
    const metaPath = this.getMetadataPath(sessionDir, contextId);

    const now = new Date().toISOString();
    const payload: StoredContextMetadata = {
      metadata,
      createdAt: createdAt ? createdAt.toISOString() : now,
      updatedAt: now
    };

    fs.writeFileSync(contentPath, content, 'utf8');
    fs.writeFileSync(metaPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  loadContext(sessionId: string, contextId: string): StoredContext | null {
    if (!this.isEnabled()) {
      throw Errors.invalidInput('storage', 'RLM_STORAGE_DIR is not configured');
    }

    this.ensureSafeId('session_id', sessionId);
    this.ensureSafeId('context_id', contextId);

    const sessionDir = path.join(this.baseDir, sessionId);
    const contentPath = this.getContentPath(sessionDir, contextId);
    const metaPath = this.getMetadataPath(sessionDir, contextId);

    if (!fs.existsSync(contentPath) || !fs.existsSync(metaPath)) {
      return null;
    }

    const content = fs.readFileSync(contentPath, 'utf8');
    const rawMeta = fs.readFileSync(metaPath, 'utf8');
    const metadata = JSON.parse(rawMeta) as StoredContextMetadata;

    return {
      content,
      metadata: metadata.metadata,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt
    };
  }

  deleteContext(sessionId: string, contextId: string): void {
    if (!this.isEnabled()) return;
    this.ensureSafeId('session_id', sessionId);
    this.ensureSafeId('context_id', contextId);

    const sessionDir = path.join(this.baseDir, sessionId);
    const contentPath = this.getContentPath(sessionDir, contextId);
    const metaPath = this.getMetadataPath(sessionDir, contextId);

    try {
      if (fs.existsSync(contentPath)) fs.unlinkSync(contentPath);
      if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
    } catch (error) {
      logger.warn('Failed to delete stored context files', {
        sessionId,
        contextId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private getContentPath(sessionDir: string, contextId: string): string {
    return path.join(sessionDir, `${contextId}.txt`);
  }

  private getMetadataPath(sessionDir: string, contextId: string): string {
    return path.join(sessionDir, `${contextId}.meta.json`);
  }

  private ensureSafeId(field: string, value: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
      throw Errors.invalidInput(field, 'Only letters, numbers, underscores, and hyphens are allowed');
    }
  }
}

export const contextStorage = new ContextStorage();
