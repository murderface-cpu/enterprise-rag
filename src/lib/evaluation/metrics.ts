/**
 * Evaluation utilities.
 *
 * Computes standard retrieval & generation metrics so the dashboard can
 * report actual quality numbers instead of vibes:
 *
 *   - recall_at_k: fraction of relevant docs in the top-K retrieved.
 *   - mrr:         mean reciprocal rank of the first relevant hit.
 *   - ndcg_at_k:   normalized discounted cumulative gain at K.
 *   - citation_precision: fraction of cited chunks that actually
 *                         contain a substring of the expected answer.
 */

import type { RetrievalHit } from "@/lib/types";

// ---------------------------------------------------------------------------
// Retrieval metrics
// ---------------------------------------------------------------------------

export interface EvalQuery {
  question: string;
  relevantDocIds?: string[];       // source filenames considered relevant
  relevantChunkIds?: string[];     // or specific chunk ids
  expectedAnswerSubstrings?: string[]; // strings the answer must contain
}

export interface RetrievalMetrics {
  recall_at_k: number;
  mrr: number;
  ndcg_at_k: number;
  hits_at_k: number;
  retrieved_ids: string[];
}

export function evaluateRetrieval(
  hits: RetrievalHit[],
  query: EvalQuery,
  k: number
): RetrievalMetrics {
  const top = hits.slice(0, k);
  const retrievedIds = top.map((h) => h.id);
  const retrievedParentIds = top.map((h) => h.metadata.parentDocId);

  // --- recall@k (against both chunk ids and parent doc ids) ---
  const relevantChunkSet = new Set(query.relevantChunkIds ?? []);
  const relevantDocSet = new Set(query.relevantDocIds ?? []);
  let relevantCount = 0;
  let hitsInTopK = 0;

  for (let i = 0; i < top.length; i++) {
    const hit = top[i];
    const isChunkMatch = relevantChunkSet.has(hit.id);
    const isDocMatch = relevantDocSet.has(hit.metadata.parentDocId);
    if (isChunkMatch || isDocMatch) {
      hitsInTopK += 1;
      relevantCount = Math.max(relevantCount, 1);
    }
  }

  const recall_at_k =
    query.relevantChunkIds?.length || query.relevantDocIds?.length
      ? hitsInTopK /
        Math.max(relevantChunkSet.size + relevantDocSet.size, 1)
      : 0;

  // --- MRR ---
  let rr = 0;
  for (let i = 0; i < top.length; i++) {
    const hit = top[i];
    if (
      relevantChunkSet.has(hit.id) ||
      relevantDocSet.has(hit.metadata.parentDocId)
    ) {
      rr = 1 / (i + 1);
      break;
    }
  }

  // --- nDCG@k (binary relevance) ---
  const gains: number[] = top.map((h) =>
    (relevantChunkSet.has(h.id) || relevantDocSet.has(h.metadata.parentDocId)) ? 1 : 0
  );
  const dcg = gains.reduce((s, g, i) => s + g / Math.log2(i + 2), 0);
  const ideal = gains.slice().sort((a, b) => b - a);
  const idcg = ideal.reduce((s, g, i) => s + g / Math.log2(i + 2), 0);
  const ndcg_at_k = idcg === 0 ? 0 : dcg / idcg;

  return {
    recall_at_k,
    mrr: rr,
    ndcg_at_k,
    hits_at_k: hitsInTopK,
    retrieved_ids: retrievedIds,
  };
}

// ---------------------------------------------------------------------------
// Generation metric
// ---------------------------------------------------------------------------

/**
 * Citation precision: for each cited chunk, did it contain at least one
 * expected answer substring? Returns a score in [0, 1].
 */
export function citationPrecision(
  citedChunks: { text: string }[],
  expectedSubstrings: string[]
): number {
  if (citedChunks.length === 0 || expectedSubstrings.length === 0) return 0;
  const lowerSnippets = citedChunks.map((c) => c.text.toLowerCase());
  const lowerExpected = expectedSubstrings.map((s) => s.toLowerCase());

  let hits = 0;
  let total = 0;
  for (const snippet of lowerSnippets) {
    for (const expected of lowerExpected) {
      total += 1;
      if (snippet.includes(expected)) hits += 1;
    }
  }
  return total === 0 ? 0 : hits / total;
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export interface AggregateReport {
  numQueries: number;
  avgRecallAtK: number;
  avgMRR: number;
  avgNDCGAtK: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgCitationPrecision: number;
  groundedOnlyFraction: number;
}

export function aggregate(
  rows: {
    retrieval: RetrievalMetrics;
    latencyMs: number;
    citationPrecision?: number;
    grounded?: boolean;
  }[]
): AggregateReport {
  const n = rows.length || 1;
  const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
  const latencies = rows.map((r) => r.latencyMs).sort((a, b) => a - b);

  return {
    numQueries: rows.length,
    avgRecallAtK: sum(rows.map((r) => r.retrieval.recall_at_k)) / n,
    avgMRR: sum(rows.map((r) => r.retrieval.mrr)) / n,
    avgNDCGAtK: sum(rows.map((r) => r.retrieval.ndcg_at_k)) / n,
    avgLatencyMs: sum(latencies) / n,
    p50LatencyMs: latencies[Math.floor(latencies.length * 0.5)] ?? 0,
    p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
    avgCitationPrecision:
      sum(rows.map((r) => r.citationPrecision ?? 0)) /
      (rows.length || 1),
    groundedOnlyFraction:
      rows.filter((r) => r.grounded).length / (rows.length || 1),
  };
}