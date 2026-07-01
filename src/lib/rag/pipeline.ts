/**
 * RAG pipeline orchestrator.
 *
 * Wires retrieval + LLM + observability into a single `answer()` call.
 * Returns an enriched response with citations, latency breakdown, and a
 * heuristic confidence label suitable for surfacing in the UI.
 */

import { BaseEmbedder, getEmbedder } from "@/lib/embeddings/embedder";
import { BaseVectorStore, getVectorStore } from "@/lib/vectorstore/store";
import { HybridRetriever, getRetriever } from "@/lib/retrieval/retriever";
import { BaseLLM, getLLM } from "@/lib/llm/client";
import { env } from "@/lib/env";
import { logger, newTraceId } from "@/lib/logger";
import { measure } from "@/lib/utils";
import type { Citation, RAGQuery, RAGResponse } from "@/lib/types";

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class RAGPipeline {
  constructor(
    private readonly retriever: HybridRetriever,
    private readonly llm: BaseLLM,
    private readonly vectorStore: BaseVectorStore
  ) {}

  async answer(query: RAGQuery): Promise<RAGResponse> {
    const traceId = newTraceId();
    const t0 = performance.now();
    const topK = query.topK ?? env.TOP_K;

    const retrievalStats = await measure(() => this.retriever.retrieve({ ...query, topK }));
    const hits = retrievalStats.result;
    const retrievalLatencyMs = retrievalStats.latencyMs;

    if (hits.length === 0) {
      const totalLatencyMs = performance.now() - t0;
      logger.info("rag.no_results", { traceId, question: query.question, totalLatencyMs });
      return {
        answer: "I don't know based on the provided context.",
        citations: [],
        observability: {
          traceId,
          retrievalLatencyMs,
          generationLatencyMs: 0,
          totalLatencyMs,
          numRetrieved: 0,
          avgRelevance: 0,
          confidence: "low",
          model: this.llm.modelName,
          groundedOnly: true,
        },
      };
    }

    const generationStats = await measure(() =>
      this.llm.generate({ question: query.question, hits })
    );
    const { text, citationsUsed, groundedOnly } = generationStats.result;
    const generationLatencyMs = generationStats.latencyMs;

    const citations: Citation[] = citationsUsed.map((idx) => {
      const hit = hits[idx];
      return {
        index: idx + 1,
        source: hit.metadata.source,
        page: hit.metadata.pages,
        chunkIndex: hit.metadata.chunkIndex,
        score: hit.score,
        snippet: hit.text.slice(0, 280),
      };
    });

    const avgRelevance = hits.reduce((s, h) => s + h.score, 0) / hits.length;
    const confidence = computeConfidence(hits.length, avgRelevance);
    const totalLatencyMs = performance.now() - t0;

    logger.info("rag.answer", {
      traceId,
      question: query.question,
      numRetrieved: hits.length,
      citationsUsed: citationsUsed.length,
      avgRelevance: Number(avgRelevance.toFixed(3)),
      confidence,
      retrievalLatencyMs: Number(retrievalLatencyMs.toFixed(1)),
      generationLatencyMs: Number(generationLatencyMs.toFixed(1)),
      totalLatencyMs: Number(totalLatencyMs.toFixed(1)),
    });

    return {
      answer: text,
      citations,
      observability: {
        traceId,
        retrievalLatencyMs,
        generationLatencyMs,
        totalLatencyMs,
        numRetrieved: hits.length,
        avgRelevance,
        confidence,
        model: this.llm.modelName,
        groundedOnly,
      },
    };
  }

  /** Lightweight retrieval-only pass for the evaluation layer. */
  async retrieve(query: RAGQuery) {
    return this.retriever.retrieve(query);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeConfidence(numHits: number, avgRelevance: number): "low" | "medium" | "high" {
  if (numHits === 0) return "low";
  if (numHits < 3) return "low";
  if (avgRelevance >= 0.7) return "high";
  if (avgRelevance >= 0.45) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Factory — caches the pipeline so callers don't rebuild components on
// every request. Components are themselves singletons via their own factories.
// ---------------------------------------------------------------------------

let cachedPipeline: RAGPipeline | null = null;

export function getRAGPipeline(): RAGPipeline {
  if (cachedPipeline) return cachedPipeline;
  const embedder: BaseEmbedder = getEmbedder();
  const vectorStore: BaseVectorStore = getVectorStore();
  const retriever = getRetriever(embedder, vectorStore);
  const llm: BaseLLM = getLLM();
  cachedPipeline = new RAGPipeline(retriever, llm, vectorStore);
  return cachedPipeline;
}

export function resetRAGPipeline(): void {
  cachedPipeline = null;
}