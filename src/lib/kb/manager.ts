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

/** Build the Redis key set for a given session namespace so each session's
 *  documents live under a disjoint keyspace (`rag:kb:<session>:*`). */
function kbKeys(ns: string) {
  const base = `rag:kb:${ns}`;
  return {
    doc: (id: string) => `${base}:doc:${id}`,
    docBySource: (source: string) => `${base}:source:${stableHash(source)}`,
    chunks: (id: string) => `${base}:chunks:${id}`,
    docIndex: `${base}:docs`,
  };
}

export class RedisKBManager implements BaseKBManager {
  private readonly redis: Redis;
  private readonly keys: ReturnType<typeof kbKeys>;

  constructor(sessionId: string, redis?: Redis) {
    if (!redis && !hasUpstashRedis) {
      throw new Error("RedisKBManager requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN");
    }
    this.redis =
      redis ??
      new Redis({
        url: env.UPSTASH_REDIS_REST_URL!,
        token: env.UPSTASH_REDIS_REST_TOKEN!,
      });
    this.keys = kbKeys(sessionId);
  }

  async listDocuments(): Promise<DocumentRecord[]> {
    const ids = await this.redis.smembers(this.keys.docIndex);
    if (!ids || ids.length === 0) return [];
    const keys = ids.map((id) => this.keys.doc(id));
    const records = await this.redis.mget<DocumentRecord[]>(...keys);
    return (records ?? []).filter((r): r is DocumentRecord => Boolean(r));
  }

  async getDocument(id: string): Promise<DocumentRecord | null> {
    const r = await this.redis.get<DocumentRecord>(this.keys.doc(id));
    return r ?? null;
  }

  async getDocumentBySource(source: string): Promise<DocumentRecord | null> {
    const id = await this.redis.get<string>(this.keys.docBySource(source));
    if (!id) return null;
    return this.getDocument(id);
  }

  async isNewOrUpdated(source: string, contentHash: string): Promise<boolean> {
    const existing = await this.getDocumentBySource(source);
    if (!existing) return true;
    return existing.contentHash !== contentHash;
  }

  async registerDocument(rec: DocumentRecord, chunkIds: string[]): Promise<void> {
    await this.redis.set(this.keys.doc(rec.id), rec);
    await this.redis.set(this.keys.docBySource(rec.source), rec.id);
    await this.redis.set(this.keys.chunks(rec.id), chunkIds);
    await this.redis.sadd(this.keys.docIndex, rec.id);
  }

  async deleteDocument(id: string): Promise<{ removedChunks: number }> {
    const rec = await this.getDocument(id);
    if (!rec) return { removedChunks: 0 };
    const chunkIds = (await this.redis.get<string[]>(this.keys.chunks(id))) ?? [];
    await this.redis.del(
      this.keys.doc(id),
      this.keys.chunks(id),
      this.keys.docBySource(rec.source)
    );
    await this.redis.srem(this.keys.docIndex, id);
    return { removedChunks: chunkIds.length };
  }

  async listChunkIdsForDocument(id: string): Promise<string[]> {
    return (await this.redis.get<string[]>(this.keys.chunks(id))) ?? [];
  }

  async totalDocuments(): Promise<number> {
    return await this.redis.scard(this.keys.docIndex);
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

// KB managers are per-session. In-memory managers are held in a globalThis
// map so state is shared across Next.js route bundles (each route otherwise
// gets its own module copy). Redis managers share one client across sessions
// and only differ by key namespace.
const globalForKBManager = globalThis as unknown as {
  __ragKBManagers?: Map<string, InMemoryKBManager>;
  __ragRedis?: Redis;
};

const DEFAULT_SESSION = "shared";

function sharedRedis(): Redis {
  if (!globalForKBManager.__ragRedis) {
    globalForKBManager.__ragRedis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL!,
      token: env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return globalForKBManager.__ragRedis;
}

/**
 * Resolve the KB manager for a session. Every session gets an isolated
 * keyspace (Redis) or an isolated in-memory instance (mock mode), so one
 * visitor can never see another's documents.
 */
export function getKBManager(sessionId: string = DEFAULT_SESSION): BaseKBManager {
  const session = sessionId || DEFAULT_SESSION;

  if (isMockMode) {
    if (!globalForKBManager.__ragKBManagers) {
      globalForKBManager.__ragKBManagers = new Map();
    }
    const map = globalForKBManager.__ragKBManagers;
    let mgr = map.get(session);
    if (!mgr) {
      logger.info("kb_manager.mock_mode", { session });
      mgr = new InMemoryKBManager();
      map.set(session, mgr);
    }
    return mgr;
  }

  if (!hasUpstashRedis) {
    throw new Error(
      "Production requires Upstash Redis for KB state. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or set ALLOW_MOCK_MODE=true."
    );
  }
  return new RedisKBManager(session, sharedRedis());
}

export function resetKBManager(): void {
  globalForKBManager.__ragKBManagers = undefined;
  globalForKBManager.__ragRedis = undefined;
}