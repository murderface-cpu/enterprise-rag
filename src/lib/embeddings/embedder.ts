/**
 * Embedding layer.
 *
 *   - BaseEmbedder:     abstract contract.
 *   - GeminiEmbedder:   production, uses Google's @google/generative-ai SDK.
 *   - MockEmbedder:     deterministic stub for local dev / CI without secrets.
 *
 * Batching and caching are handled here so callers (the ingestion pipeline
 * and the retriever) can stay simple.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { env, isMockMode } from "@/lib/env";
import { logger } from "@/lib/logger";
import { chunks as chunkArray, stableHash } from "@/lib/utils";
import type { Chunk } from "@/lib/types";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface BaseEmbedder {
  readonly modelName: string;
  readonly dimension: number;
  embed(texts: string[]): Promise<number[][]>;
  embedQuery(query: string): Promise<number[]>;
}

// ---------------------------------------------------------------------------
// Cache (in-memory LRU + optional Redis persistence)
// ---------------------------------------------------------------------------

interface CacheEntry {
  vector: number[];
  cachedAt: number;
}

class LRUCache<K, V> {
  private map = new Map<K, V>();
  constructor(private readonly maxSize: number) {}
  get(k: K): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      // Refresh recency.
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: K, v: V): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.maxSize) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
  }
  clear(): void {
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}

// ---------------------------------------------------------------------------
// Mock embedder
// ---------------------------------------------------------------------------

export class MockEmbedder implements BaseEmbedder {
  readonly modelName = "mock-hash-768";
  readonly dimension = env.EMBEDDING_DIM;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this._vectorFor(t));
  }

  async embedQuery(query: string): Promise<number[]> {
    return this._vectorFor(query);
  }

  /**
   * Deterministic pseudo-embedding derived from text content.
   *
   * Mock mode is for local dev / CI without secrets. The point isn't
   * realistic semantic similarity; it's stable vectors that produce
   * useful ranking *and* survive the `MIN_RELEVANCE_SCORE` filter.
   *
   * Strategy: project the term-frequency vector into a fixed-size dense
   * vector via feature hashing, then L2-normalize. Documents that share
   * tokens with the query will have a high cosine similarity.
   */
  private _vectorFor(text: string): number[] {
    const vec = new Array<number>(this.dimension).fill(0);
    const tokens = text.toLowerCase().split(/\W+/).filter((t) => t.length > 1);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    for (const [term, count] of tf.entries()) {
      const idx = parseInt(stableHash(term).slice(0, 8), 16) % this.dimension;
      // sub-linear TF + sign trick so dot products reflect overlap
      vec[idx] += 1 + Math.log(count);
    }

    // Normalize to unit length.
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}

// ---------------------------------------------------------------------------
// Gemini embedder (production)
// ---------------------------------------------------------------------------

const GEMINI_BATCH = 100; // Gemini's embed_content supports up to 100 inputs per call.

export class GeminiEmbedder implements BaseEmbedder {
  readonly modelName: string;
  readonly dimension: number;

  private readonly client: GoogleGenerativeAI;
  private readonly cache = new LRUCache<string, CacheEntry>(2000);

  constructor(modelName?: string, dimension?: number) {
    this.modelName = modelName ?? env.EMBEDDING_MODEL;
    this.dimension = dimension ?? env.EMBEDDING_DIM;
    this.client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const out: number[][] = new Array(texts.length);
    const missing: { idx: number; text: string }[] = [];

    texts.forEach((t, idx) => {
      const cached = this.cache.get(stableHash(t));
      if (cached) {
        out[idx] = cached.vector;
      } else {
        missing.push({ idx, text: t });
      }
    });

    if (missing.length === 0) return out;

    for (const batch of chunkArray(missing, GEMINI_BATCH)) {
      const inputs = batch.map((b) => b.text);
      try {
        const model = this.client.getGenerativeModel({ model: this.modelName });
        const result = await model.batchEmbedContents({
          requests: inputs.map((t) => ({ content: { role: "user", parts: [{ text: t }] } })),
        });
        result.embeddings.forEach((e, i) => {
          const vec = e.values ?? [];
          const original = batch[i];
          out[original.idx] = vec;
          this.cache.set(stableHash(original.text), { vector: vec, cachedAt: Date.now() });
        });
      } catch (err) {
        logger.error("embedding.batch_failed", {
          batchSize: batch.length,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }

    return out;
  }

  async embedQuery(query: string): Promise<number[]> {
    const [vec] = await this.embed([query]);
    if (!vec) throw new Error("Embedding failed: empty result");
    return vec;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let cached: BaseEmbedder | null = null;

export function getEmbedder(): BaseEmbedder {
  if (cached) return cached;
  cached = isMockMode ? new MockEmbedder() : new GeminiEmbedder();
  return cached;
}

/** Reset for tests / hot reloads. */
export function resetEmbedder(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// Convenience: embed chunks in batched calls.
// ---------------------------------------------------------------------------

export async function embedChunks(chunks: Chunk[]): Promise<{ id: string; vector: number[]; metadata: Chunk["metadata"] }[]> {
  if (chunks.length === 0) return [];
  const embedder = getEmbedder();
  const vectors = await embedder.embed(chunks.map((c) => c.text));
  return chunks.map((c, i) => ({
    id: c.id,
    vector: vectors[i],
    metadata: c.metadata,
  }));
}