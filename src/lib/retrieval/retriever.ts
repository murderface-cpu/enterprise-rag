/**
 * Retrieval layer.
 *
 *   - Dense retriever: vector similarity via the vector store.
 *   - Hybrid retriever: dense + lightweight in-memory BM25 keyword scoring.
 *
 * Hybrid retrieval is the single biggest retrieval-quality win for
 * enterprise corpora that mix prose with precise technical terms
 * (SKU codes, product names, error codes). When a query contains an
 * exact term, BM25 brings it to the top even if the embedding model
 * de-emphasizes it.
 */

import { BaseEmbedder } from "@/lib/embeddings/embedder";
import { BaseVectorStore } from "@/lib/vectorstore/store";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { RetrievalHit, RAGQuery } from "@/lib/types";

// ---------------------------------------------------------------------------
// Dense retriever
// ---------------------------------------------------------------------------

export class DenseRetriever {
  constructor(
    private readonly embedder: BaseEmbedder,
    private readonly vectorStore: BaseVectorStore
  ) {}

  async retrieve(query: RAGQuery): Promise<RetrievalHit[]> {
    const topK = query.topK ?? env.TOP_K;
    const queryVector = await this.embedder.embedQuery(query.question);

    // Coerce filter values to strings: Upstash Vector filter DSL is string-only.
    const filter: Record<string, string> | undefined = query.filter
      ? Object.fromEntries(
          Object.entries(query.filter).map(([k, v]) => [k, String(v)])
        )
      : undefined;

    const hits = await this.vectorStore.search(queryVector, topK, filter, query.question);

    logger.debug("retrieval.dense", {
      topK,
      hits: hits.length,
      topScore: hits[0]?.score ?? 0,
    });

    return hits;
  }
}

// ---------------------------------------------------------------------------
// BM25 (lightweight, no external deps)
// ---------------------------------------------------------------------------

interface BM25Doc {
  id: string;
  text: string;
  terms: string[];
  length: number;
  metadata: RetrievalHit["metadata"];
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "has", "he", "in", "is", "it", "its", "of", "on", "that", "the",
  "to", "was", "were", "will", "with", "this", "but", "or", "not",
  "we", "you", "i", "they", "them", "our", "your", "their",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

class BM25Index {
  private k1 = 1.5;
  private b = 0.75;
  private docs: BM25Doc[] = [];
  private docFreqs = new Map<string, number>();
  private avgDocLen = 0;

  build(hits: RetrievalHit[]): void {
    this.docs = hits.map((h) => {
      const terms = tokenize(h.text);
      const seen = new Set<string>();
      for (const t of terms) seen.add(t);
      for (const t of seen) {
        this.docFreqs.set(t, (this.docFreqs.get(t) ?? 0) + 1);
      }
      return { id: h.id, text: h.text, terms, length: terms.length, metadata: h.metadata };
    });
    this.avgDocLen = this.docs.length === 0
      ? 1
      : this.docs.reduce((s, d) => s + d.length, 0) / this.docs.length;
  }

  score(query: string): Map<string, number> {
    const qTerms = tokenize(query);
    const scores = new Map<string, number>();
    const N = this.docs.length;
    if (N === 0) return scores;

    for (const qt of qTerms) {
      const df = this.docFreqs.get(qt) ?? 0;
      if (df === 0) continue;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));

      for (const d of this.docs) {
        let tf = 0;
        for (const t of d.terms) if (t === qt) tf++;
        if (tf === 0) continue;
        const norm = tf * (this.k1 + 1);
        const denom = tf + this.k1 * (1 - this.b + this.b * (d.length / this.avgDocLen));
        scores.set(d.id, (scores.get(d.id) ?? 0) + idf * (norm / denom));
      }
    }
    return scores;
  }
}

// ---------------------------------------------------------------------------
// Hybrid retriever (dense + BM25, RRF fusion)
// ---------------------------------------------------------------------------

export interface HybridRetrieverOptions {
  denseWeight?: number;
  bm25Weight?: number;
  /** Candidate oversampling factor: fetch this many times more than topK
   *  from the dense index, then re-rank with BM25, then return topK. */
  oversample?: number;
}

export class HybridRetriever {
  private readonly dense: DenseRetriever;
  private readonly options: Required<HybridRetrieverOptions>;

  constructor(embedder: BaseEmbedder, vectorStore: BaseVectorStore, opts: HybridRetrieverOptions = {}) {
    this.dense = new DenseRetriever(embedder, vectorStore);
    this.options = {
      denseWeight: opts.denseWeight ?? 0.7,
      bm25Weight: opts.bm25Weight ?? 0.3,
      oversample: opts.oversample ?? 4,
    };
  }

  async retrieve(query: RAGQuery): Promise<RetrievalHit[]> {
    const topK = query.topK ?? env.TOP_K;
    const candidateK = Math.max(topK * this.options.oversample, topK);

    const denseHits = await this.dense.retrieve({ ...query, topK: candidateK });
    if (denseHits.length === 0) return [];

    const bm25 = new BM25Index();
    bm25.build(denseHits);
    const bm25Scores = bm25.score(query.question);

    // Reciprocal rank fusion.
    const fused = new Map<string, { hit: RetrievalHit; score: number }>();
    const k = 60; // RRF constant

    denseHits.forEach((hit, i) => {
      const rrf = 1 / (k + i + 1);
      fused.set(hit.id, {
        hit,
        score: this.options.denseWeight * rrf + this.options.bm25Weight * 0, // dense contribution
      });
    });

    // Convert BM25 scores → ranks → RRF
    const sortedBm25 = [...bm25Scores.entries()].sort((a, b) => b[1] - a[1]);
    sortedBm25.forEach(([id], i) => {
      const entry = fused.get(id);
      if (!entry) return;
      const rrf = 1 / (k + i + 1);
      entry.score += this.options.bm25Weight * rrf;
    });

    // Normalize scores to [0,1] for downstream confidence calculation.
    const max = Math.max(...[...fused.values()].map((v) => v.score), 1e-9);
    const ranked = [...fused.values()]
      .map((v) => ({ hit: v.hit, score: v.score / max }))
      .sort((a, b) => b.score - a.score);

    const out = ranked.slice(0, topK).map((r) => ({ ...r.hit, score: r.score }));

    logger.debug("retrieval.hybrid", {
      topK,
      denseCandidates: denseHits.length,
      returned: out.length,
      topScore: out[0]?.score ?? 0,
    });

    return out;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function getRetriever(embedder: BaseEmbedder, vectorStore: BaseVectorStore) {
  return new HybridRetriever(embedder, vectorStore);
}