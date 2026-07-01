/**
 * GET /api/metrics
 *
 * Returns request counts, average latency per route, KB stats, and
 * current configuration. Useful for dashboards and CI checks.
 */

import { withRoute, json, optionsHandler } from "@/lib/api/helpers";
import { getKBManager } from "@/lib/kb/manager";
import { getVectorStore } from "@/lib/vectorstore/store";
import { snapshot } from "@/lib/observability/metrics";
import { env, isMockMode, hasUpstashVector, hasUpstashRedis } from "@/lib/env";
import type { SystemMetrics } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const OPTIONS = optionsHandler;

export const GET = withRoute("metrics", async () => {
  const kb = getKBManager();
  const vs = getVectorStore();
  const snap = snapshot();

  const [totalDocuments, totalChunks, vectorStoreSize] = await Promise.all([
    kb.totalDocuments(),
    kb.totalChunks(),
    vs.count(),
  ]);

  const metrics: SystemMetrics = {
    totalDocuments,
    totalChunks,
    vectorStoreSize,
    embeddingModel: env.EMBEDDING_MODEL,
    llmModel: env.LLM_MODEL,
    chunkSize: env.CHUNK_SIZE,
    chunkOverlap: env.CHUNK_OVERLAP,
    topK: env.TOP_K,
    uptimeSeconds: snap.uptimeSeconds,
    requestCounts: snap.requestCounts,
    averageLatencyMs: snap.averageLatencyMs,
    isMockMode,
  };

  return json(metrics, { status: 200 });
});