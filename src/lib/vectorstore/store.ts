/**
 * Vector store abstraction.
 *
 *   - UpstashVectorStore: production — uses Upstash Vector (REST, edge-safe).
 *   - InMemoryVectorStore: mock-mode fallback that holds vectors in process
 *                          memory. NOT persistent across cold starts; intended
 *                          only for local dev without secrets.
 *
 * Upstash Vector returns similarity *score* in [0, 1] (cosine similarity).
 * We expose a single `search()` API that returns ranked hits.
 */

import { Index } from "@upstash/vector";
import { env, hasUpstashVector, isMockMode } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { ChunkMetadata, RetrievalHit } from "@/lib/types";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface BaseVectorStore {
  upsert(items: { id: string; vector: number[]; metadata: Record<string, unknown> }[]): Promise<void>;
  delete(ids: string[]): Promise<void>;
  deleteByFilter(filter: Record<string, string>): Promise<number>;
  search(queryVector: number[], topK: number, filter?: Record<string, string>): Promise<RetrievalHit[]>;
  count(): Promise<number>;
  reset(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Upstash Vector
// ---------------------------------------------------------------------------

interface UpstashMetadata {
  text: string;
  source: string;
  type: string;
  parentDocId: string;
  chunkIndex: number;
  chunkSize: number;
  uploadedAt: string;
  contentHash: string;
  pages?: number;
  charStart: number;
  charEnd: number;
  // Allow extra fields without breaking Dict constraint.
  [key: string]: unknown;
}

export class UpstashVectorStore implements BaseVectorStore {
  private readonly index: Index;
  private readonly dimension: number;

  constructor() {
    if (!hasUpstashVector) {
      throw new Error("UpstashVectorStore requires UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN");
    }
    this.dimension = env.EMBEDDING_DIM;
    this.index = new Index({
      url: env.UPSTASH_VECTOR_REST_URL!,
      token: env.UPSTASH_VECTOR_REST_TOKEN!,
    });
  }

  async upsert(items: { id: string; vector: number[]; metadata: Record<string, unknown> }[]): Promise<void> {
    if (items.length === 0) return;
    // Sanity: Upstash requires fixed dimension. If a chunk's vector length
    // doesn't match, drop it with a warning rather than crashing the whole
    // batch — the alternative is to lose all subsequent good vectors.
    const good = items.filter((i) => i.vector.length === this.dimension);
    if (good.length < items.length) {
      logger.warn("vector_store.dimension_mismatch", {
        expected: this.dimension,
        dropped: items.length - good.length,
      });
    }
    if (good.length === 0) return;

    await this.index.upsert(
      good.map((i) => ({
        id: i.id,
        vector: i.vector,
        metadata: i.metadata as unknown as Record<string, unknown>,
      }))
    );
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.index.delete(ids);
  }

  async deleteByFilter(filter: Record<string, string>): Promise<number> {
    // Upstash Vector supports delete-by-filter via top-level API.
    const before = await this.count();
    await this.index.delete({ filter: Object.entries(filter).map(([k, v]) => `${k} = '${v}'`).join(" AND ") } as never);
    const after = await this.count();
    return Math.max(0, before - after);
  }

  async search(queryVector: number[], topK: number, filter?: Record<string, string>): Promise<RetrievalHit[]> {
    if (queryVector.length !== this.dimension) {
      throw new Error(`query vector dim ${queryVector.length} != index dim ${this.dimension}`);
    }
    const f = filter
      ? Object.entries(filter)
          .map(([k, v]) => `${k} = '${String(v).replace(/'/g, "\\'")}'`)
          .join(" AND ")
      : undefined;
    const result = await this.index.query({
      vector: queryVector,
      topK,
      includeMetadata: true,
      ...(f ? { filter: f } : {}),
    });

    return (result ?? [])
      .filter((r) => r.score >= env.MIN_RELEVANCE_SCORE)
      .map((r) => this._toHit(String(r.id), r.metadata as UpstashMetadata | undefined, r.score));
  }

  async count(): Promise<number> {
    const info = await this.index.info();
    return info.vectorCount ?? 0;
  }

  async reset(): Promise<void> {
    await this.index.reset();
  }

  private _toHit(id: string, metadata: UpstashMetadata | undefined, score: number): RetrievalHit {
    const md: UpstashMetadata = metadata ?? {
      text: "",
      source: "",
      type: "txt",
      parentDocId: "",
      chunkIndex: 0,
      chunkSize: 0,
      uploadedAt: new Date().toISOString(),
      contentHash: "",
      charStart: 0,
      charEnd: 0,
    };
    const chunkMeta: ChunkMetadata = {
      source: md.source ?? "",
      type: (md.type as ChunkMetadata["type"]) ?? "txt",
      uploadedAt: md.uploadedAt ?? new Date().toISOString(),
      contentHash: md.contentHash ?? "",
      pages: md.pages,
      parentDocId: md.parentDocId ?? "",
      chunkIndex: md.chunkIndex ?? 0,
      chunkSize: md.chunkSize ?? 0,
      charStart: md.charStart ?? 0,
      charEnd: md.charEnd ?? 0,
    };
    return {
      id,
      score,
      text: md.text ?? "",
      metadata: chunkMeta,
    };
  }
}

// ---------------------------------------------------------------------------
// In-memory store (mock-mode)
// ---------------------------------------------------------------------------

interface MemoryEntry {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export class InMemoryVectorStore implements BaseVectorStore {
  private items: MemoryEntry[] = [];

  async upsert(items: { id: string; vector: number[]; metadata: Record<string, unknown> }[]): Promise<void> {
    for (const item of items) {
      const existing = this.items.findIndex((i) => i.id === item.id);
      if (existing >= 0) this.items[existing] = item;
      else this.items.push(item);
    }
  }

  async delete(ids: string[]): Promise<void> {
    const set = new Set(ids);
    this.items = this.items.filter((i) => !set.has(i.id));
  }

  async deleteByFilter(filter: Record<string, string>): Promise<number> {
    const before = this.items.length;
    this.items = this.items.filter((i) => {
      for (const [k, v] of Object.entries(filter)) {
        if ((i.metadata as Record<string, unknown>)[k] !== v) return true;
      }
      return false;
    });
    return before - this.items.length;
  }

  async search(queryVector: number[], topK: number, filter?: Record<string, string>): Promise<RetrievalHit[]> {
    const filtered = filter
      ? this.items.filter((i) => {
          for (const [k, v] of Object.entries(filter)) {
            if ((i.metadata as Record<string, unknown>)[k] !== v) return false;
          }
          return true;
        })
      : this.items;

    const scored = filtered.map((i) => ({
      entry: i,
      score: cosineSimilarity(queryVector, i.vector),
    }));

    scored.sort((a, b) => b.score - a.score);

    // In mock mode we have no real embedding model — similarity scores
    // are loose at best. Don't apply the relevance threshold here; the
    // UI's confidence badge already reflects low scores, and aggressive
    // filtering makes the demo look broken.
    const minScore = isMockMode ? 0 : env.MIN_RELEVANCE_SCORE;

    return scored
      .filter((s) => s.score >= minScore)
      .slice(0, topK)
      .map((s) => this._toHit(s.entry.id, s.entry.metadata, s.score));
  }

  async count(): Promise<number> {
    return this.items.length;
  }

  async reset(): Promise<void> {
    this.items = [];
  }

  private _toHit(id: string, metadata: Record<string, unknown>, score: number): RetrievalHit {
    const md = metadata as unknown as UpstashMetadata;
    const chunkMeta: ChunkMetadata = {
      source: md.source ?? "",
      type: (md.type as ChunkMetadata["type"]) ?? "txt",
      uploadedAt: md.uploadedAt ?? new Date().toISOString(),
      contentHash: md.contentHash ?? "",
      pages: md.pages,
      parentDocId: md.parentDocId ?? "",
      chunkIndex: md.chunkIndex ?? 0,
      chunkSize: md.chunkSize ?? 0,
      charStart: md.charStart ?? 0,
      charEnd: md.charEnd ?? 0,
    };
    return { id, score, text: md.text ?? "", metadata: chunkMeta };
  }
}

// ---------------------------------------------------------------------------
// Factory + singleton
// ---------------------------------------------------------------------------

let cached: BaseVectorStore | null = null;

export function getVectorStore(): BaseVectorStore {
  if (cached) return cached;
  if (isMockMode) {
    logger.info("vector_store.mock_mode");
    cached = new InMemoryVectorStore();
  } else {
    if (!hasUpstashVector) {
      throw new Error(
        "Production requires Upstash Vector. Set UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN, or set ALLOW_MOCK_MODE=true for local dev."
      );
    }
    cached = new UpstashVectorStore();
  }
  return cached;
}

export function resetVectorStore(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}