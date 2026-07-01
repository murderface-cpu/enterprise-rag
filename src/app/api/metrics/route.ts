/**
 * GET /api/metrics
 *
 * Returns request counts, average latency per route, KB stats, and
 * current configuration. Useful for dashboards and CI checks.
 */

import { withRoute, json, optionsHandler } from "@/lib/api/helpers";
import { getKBManager } from "@/lib/kb/manager";
import { getLLM } from "@/lib/llm/client";
import { getEmbedder } from "@/lib/embeddings/embedder";
import { snapshot } from "@/lib/observability/metrics";
import { env, isMockMode, hasUpstashVector, hasUpstashRedis } from "@/lib/env";
import type { SystemMetrics } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const OPTIONS = optionsHandler;

export const GET = withRoute("metrics", async (_req, ctx) => {
  const kb = getKBManager(ctx.sessionId);
  const snap = snapshot();

  // Counts reflect the caller's own session, not the shared index total, so
  // one visitor's dashboard never reveals how much data others have uploaded.
  const [totalDocuments, totalChunks] = await Promise.all([
    kb.totalDocuments(),
    kb.totalChunks(),
  ]);

  const metrics: SystemMetrics = {
    totalDocuments,
    totalChunks,
    vectorStoreSize: totalChunks,
    embeddingModel: getEmbedder().modelName,
    llmModel: getLLM().modelName,
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