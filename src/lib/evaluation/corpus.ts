/**
 * Evaluation corpus.
 *
 * Two sources:
 *   1. `buildCorpusFromKB` (preferred) synthesizes an eval set from the
 *      documents currently in the caller's knowledge base, so the numbers on
 *      the dashboard reflect the user's OWN corpus, not a canned sample.
 *   2. `DEFAULT_EVAL_CORPUS` is a small built-in fallback used only when the
 *      knowledge base is empty (e.g. a fresh session with nothing uploaded).
 */

import { getKBManager } from "@/lib/kb/manager";
import { getVectorStore } from "@/lib/vectorstore/store";
import { generatePlainText } from "@/lib/llm/client";
import { logger } from "@/lib/logger";
import type { DocumentRecord } from "@/lib/kb/manager";

export interface EvalCase {
  question: string;
  relevantDocIds?: string[];
  relevantChunkIds?: string[];
  expectedAnswerSubstrings?: string[];
}

export const DEFAULT_EVAL_CORPUS: EvalCase[] = [
  {
    question: "What is Retrieval-Augmented Generation?",
    relevantDocIds: ["rag-overview.md"],
    expectedAnswerSubstrings: ["retrieval", "generation", "context"],
  },
  {
    question: "How does the knowledge base stay up to date?",
    relevantDocIds: ["ingestion-lifecycle.md"],
    expectedAnswerSubstrings: ["incremental", "content hash", "vector store"],
  },
  {
    question: "Which vector database does this system use?",
    relevantDocIds: ["architecture.md"],
    expectedAnswerSubstrings: ["Upstash Vector", "managed"],
  },
  {
    question: "How is the answer grounded in the sources?",
    relevantDocIds: ["grounding-and-citations.md"],
    expectedAnswerSubstrings: ["context only", "citation", "[1]"],
  },
  {
    question: "What chunking strategy is used?",
    relevantDocIds: ["architecture.md"],
    expectedAnswerSubstrings: ["recursive", "overlap"],
  },
];

// ---------------------------------------------------------------------------
// KB-derived corpus
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "he",
  "in", "is", "it", "its", "of", "on", "that", "the", "to", "was", "were",
  "will", "with", "this", "but", "or", "not", "we", "you", "they", "them",
  "our", "your", "their", "which", "what", "how", "when", "where", "who",
]);

/** Evenly sample up to `n` items so we cover the corpus, not just its head. */
function sampleEvenly<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const step = items.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.floor(i * step)]);
  return out;
}

/** Distinctive, lowercased terms from a passage, longest first. */
function keyTerms(text: string, count: number): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const tok of text.toLowerCase().replace(/[^a-z0-9_\-\s]/g, " ").split(/\s+/)) {
    if (tok.length < 4 || STOPWORDS.has(tok) || seen.has(tok)) continue;
    seen.add(tok);
    terms.push(tok);
  }
  return terms.sort((a, b) => b.length - a.length).slice(0, count);
}

/** Deterministic fallback question when no LLM is available. */
function extractQuestion(text: string): string {
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0]?.trim() ?? text.trim();
  const cleaned = firstSentence.replace(/\s+/g, " ").slice(0, 160);
  return cleaned.endsWith("?") ? cleaned : `What does the document say about "${cleaned}"?`;
}

const questionPrompt = (text: string) =>
  `You are building an evaluation set for a document retrieval system.
Read the passage and write ONE clear, natural question that a user could ask and that is answered by the passage.
Return ONLY the question text, with no quotes or preamble.

Passage:
"""
${text.slice(0, 1200)}
"""

Question:`;

export interface BuiltCorpus {
  cases: EvalCase[];
  source: "kb" | "empty";
  documentCount: number;
}

/**
 * Build an eval corpus from a session's current documents. For a sample of
 * documents we pull the first chunk's text and turn it into a question
 * (via the LLM, or a deterministic extraction fallback). Ground-truth
 * relevance is the document that chunk came from.
 */
export async function buildCorpusFromKB(
  sessionId: string,
  sampleSize = 6
): Promise<BuiltCorpus> {
  const kb = getKBManager(sessionId);
  const vs = getVectorStore();

  const docs = await kb.listDocuments();
  if (docs.length === 0) return { cases: [], source: "empty", documentCount: 0 };

  const sampled = sampleEvenly(docs, sampleSize);

  // First chunk id per sampled document.
  const picks: { doc: DocumentRecord; chunkId: string }[] = [];
  for (const doc of sampled) {
    const ids = await kb.listChunkIdsForDocument(doc.id);
    if (ids.length > 0) picks.push({ doc, chunkId: ids[0] });
  }

  const hits = await vs.fetch(picks.map((p) => p.chunkId));
  const textById = new Map(hits.map((h) => [h.id, h.text]));

  const cases: EvalCase[] = [];
  for (const { doc, chunkId } of picks) {
    const text = (textById.get(chunkId) ?? "").trim();
    if (!text) continue;

    // gpt-oss and other reasoning models spend tokens thinking before they
    // emit output, so give the budget real headroom or the content comes back empty.
    const generated = await generatePlainText(questionPrompt(text), { maxTokens: 512 });
    const question =
      generated?.replace(/^["'\s]+|["'\s]+$/g, "").split("\n")[0]?.trim() || extractQuestion(text);

    cases.push({
      question,
      relevantDocIds: [doc.id],
      expectedAnswerSubstrings: keyTerms(text, 4),
    });
  }

  logger.info("evaluation.corpus_built", {
    session: sessionId,
    documents: docs.length,
    cases: cases.length,
  });

  return { cases, source: "kb", documentCount: docs.length };
}
