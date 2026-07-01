/**
 * Custom sparse encoder for Upstash hybrid indexes.
 *
 * A hybrid Upstash Vector index scores the DENSE component (our semantic
 * embeddings) and a SPARSE component (keyword signal) separately, then fuses
 * them (RRF by default). For a "Custom" sparse index we supply the sparse
 * vector ourselves: a bag-of-words where each dimension is a hashed token id
 * and its value is the raw term frequency.
 *
 * Pairing this with `WeightingStrategy.IDF` at query time lets Upstash apply
 * BM25-style inverse-document-frequency weighting server-side, so common
 * tokens are down-weighted without us maintaining any corpus statistics.
 */

import { stableHash } from "@/lib/utils";

export interface SparseVec {
  indices: number[];
  values: number[];
}

// Compact, high-signal stopword list. Keeping it small avoids dropping tokens
// that matter for enterprise corpora (codes, short identifiers).
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

/** Map a token to a stable non-negative 32-bit index. */
function tokenIndex(token: string): number {
  return parseInt(stableHash(token).slice(0, 8), 16) >>> 0;
}

/**
 * Encode text into a sparse term-frequency vector. Hash collisions simply sum
 * their counts, which is harmless for retrieval. Always returns at least one
 * dimension so a hybrid index never rejects an otherwise-empty query.
 */
export function encodeSparse(text: string): SparseVec {
  const counts = new Map<number, number>();
  for (const token of tokenize(text)) {
    const idx = tokenIndex(token);
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
  }

  if (counts.size === 0) {
    // Fallback: hash the whole (trimmed) string as a single term so the
    // sparse component is non-empty even for all-stopword inputs.
    const seed = text.trim() || "empty";
    counts.set(tokenIndex(seed), 1);
  }

  const indices = [...counts.keys()];
  const values = indices.map((i) => counts.get(i)!);
  return { indices, values };
}
