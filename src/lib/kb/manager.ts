/**
 * Knowledge-base state management.
 *
 * Persists in Redis (when available) or in-process (mock mode):
 *
 *   - Document registry: source filename → content hash, uploadedAt, chunk count
 *   - Per-chunk IDs: so deletion/refresh can clean up old vectors cleanly
 *
 * The Redis layer uses Upstash REST so it's edge-compatible.
 *
 * State is keyed under `rag:kb:*` for easy inspection in the Upstash console
 * and bulk deletion on a full reset.
 */

import { Redis } from "@upstash/redis";
import { env, hasUpstashRedis, isMockMode } from "@/lib/env";
import { logger } from "@/lib/logger";
import { stableHash } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocumentRecord {
  id: string;             // doc_<hash>
  source: string;         // original filename
  contentHash: string;
  uploadedAt: string;
  chunkCount: number;
  sizeBytes: number;
  type: string;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface BaseKBManager {
  listDocuments(): Promise<DocumentRecord[]>;
  getDocument(id: string): Promise<DocumentRecord | null>;
  getDocumentBySource(source: string): Promise<DocumentRecord | null>;
  isNewOrUpdated(source: string, contentHash: string): Promise<boolean>;
  registerDocument(rec: DocumentRecord, chunkIds: string[]): Promise<void>;
  deleteDocument(id: string): Promise<{ removedChunks: number }>;
  listChunkIdsForDocument(id: string): Promise<string[]>;
  totalDocuments(): Promise<number>;
  totalChunks(): Promise<number>;
}

// ---------------------------------------------------------------------------
// Redis-backed implementation
// ---------------------------------------------------------------------------

const KB_KEYS = {
  doc: (id: string) => `rag:kb:doc:${id}`,
  docBySource: (source: string) => `rag:kb:source:${stableHash(source)}`,
  chunks: (id: string) => `rag:kb:chunks:${id}`,
  docIndex: "rag:kb:docs",
};

export class RedisKBManager implements BaseKBManager {
  private readonly redis: Redis;

  constructor() {
    if (!hasUpstashRedis) {
      throw new Error("RedisKBManager requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN");
    }
    this.redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL!,
      token: env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }

  async listDocuments(): Promise<DocumentRecord[]> {
    const ids = await this.redis.smembers(KB_KEYS.docIndex);
    if (!ids || ids.length === 0) return [];
    const keys = ids.map((id) => KB_KEYS.doc(id));
    const records = await this.redis.mget<DocumentRecord[]>(...keys);
    return (records ?? []).filter((r): r is DocumentRecord => Boolean(r));
  }

  async getDocument(id: string): Promise<DocumentRecord | null> {
    const r = await this.redis.get<DocumentRecord>(KB_KEYS.doc(id));
    return r ?? null;
  }

  async getDocumentBySource(source: string): Promise<DocumentRecord | null> {
    const id = await this.redis.get<string>(KB_KEYS.docBySource(source));
    if (!id) return null;
    return this.getDocument(id);
  }

  async isNewOrUpdated(source: string, contentHash: string): Promise<boolean> {
    const existing = await this.getDocumentBySource(source);
    if (!existing) return true;
    return existing.contentHash !== contentHash;
  }

  async registerDocument(rec: DocumentRecord, chunkIds: string[]): Promise<void> {
    await this.redis.set(KB_KEYS.doc(rec.id), rec);
    await this.redis.set(KB_KEYS.docBySource(rec.source), rec.id);
    await this.redis.set(KB_KEYS.chunks(rec.id), chunkIds);
    await this.redis.sadd(KB_KEYS.docIndex, rec.id);
  }

  async deleteDocument(id: string): Promise<{ removedChunks: number }> {
    const rec = await this.getDocument(id);
    if (!rec) return { removedChunks: 0 };
    const chunkIds = (await this.redis.get<string[]>(KB_KEYS.chunks(id))) ?? [];
    await this.redis.del(
      KB_KEYS.doc(id),
      KB_KEYS.chunks(id),
      KB_KEYS.docBySource(rec.source)
    );
    await this.redis.srem(KB_KEYS.docIndex, id);
    return { removedChunks: chunkIds.length };
  }

  async listChunkIdsForDocument(id: string): Promise<string[]> {
    return (await this.redis.get<string[]>(KB_KEYS.chunks(id))) ?? [];
  }

  async totalDocuments(): Promise<number> {
    return await this.redis.scard(KB_KEYS.docIndex);
  }

  async totalChunks(): Promise<number> {
    const docs = await this.listDocuments();
    return docs.reduce((sum, d) => sum + d.chunkCount, 0);
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation (mock mode)
// ---------------------------------------------------------------------------

export class InMemoryKBManager implements BaseKBManager {
  private docs = new Map<string, DocumentRecord>();
  private bySource = new Map<string, string>(); // source → id
  private chunksByDoc = new Map<string, string[]>();

  async listDocuments(): Promise<DocumentRecord[]> {
    return [...this.docs.values()];
  }

  async getDocument(id: string): Promise<DocumentRecord | null> {
    return this.docs.get(id) ?? null;
  }

  async getDocumentBySource(source: string): Promise<DocumentRecord | null> {
    const id = this.bySource.get(source);
    return id ? this.docs.get(id) ?? null : null;
  }

  async isNewOrUpdated(source: string, contentHash: string): Promise<boolean> {
    const existing = await this.getDocumentBySource(source);
    if (!existing) return true;
    return existing.contentHash !== contentHash;
  }

  async registerDocument(rec: DocumentRecord, chunkIds: string[]): Promise<void> {
    this.docs.set(rec.id, rec);
    this.bySource.set(rec.source, rec.id);
    this.chunksByDoc.set(rec.id, chunkIds);
  }

  async deleteDocument(id: string): Promise<{ removedChunks: number }> {
    const rec = this.docs.get(id);
    if (!rec) return { removedChunks: 0 };
    this.docs.delete(id);
    this.bySource.delete(rec.source);
    const chunkIds = this.chunksByDoc.get(id) ?? [];
    this.chunksByDoc.delete(id);
    return { removedChunks: chunkIds.length };
  }

  async listChunkIdsForDocument(id: string): Promise<string[]> {
    return this.chunksByDoc.get(id) ?? [];
  }

  async totalDocuments(): Promise<number> {
    return this.docs.size;
  }

  async totalChunks(): Promise<number> {
    let total = 0;
    for (const ids of this.chunksByDoc.values()) total += ids.length;
    return total;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let cached: BaseKBManager | null = null;

export function getKBManager(): BaseKBManager {
  if (cached) return cached;
  if (isMockMode) {
    logger.info("kb_manager.mock_mode");
    cached = new InMemoryKBManager();
  } else {
    if (!hasUpstashRedis) {
      throw new Error(
        "Production requires Upstash Redis for KB state. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or set ALLOW_MOCK_MODE=true."
      );
    }
    cached = new RedisKBManager();
  }
  return cached;
}

export function resetKBManager(): void {
  cached = null;
}