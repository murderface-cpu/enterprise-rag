/**
 * GET  /api/health    → readiness/liveness probe
 * GET  /api/metrics   → request counts, latency, KB stats
 */

import { withRoute, json, optionsHandler } from "@/lib/api/helpers";
import { getKBManager } from "@/lib/kb/manager";
import { getVectorStore } from "@/lib/vectorstore/store";
import { snapshot } from "@/lib/observability/metrics";
import { env, isMockMode, hasUpstashVector, hasUpstashRedis } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const OPTIONS = optionsHandler;

export const GET = withRoute("health", async () => {
  const checks: Record<string, "ok" | "degraded" | "down"> = {};

  try {
    const vs = getVectorStore();
    const c = await vs.count();
    checks.vector_store = c >= 0 ? "ok" : "down";
  } catch {
    checks.vector_store = "down";
  }

  try {
    const kb = getKBManager();
    await kb.totalDocuments();
    checks.kb_manager = "ok";
  } catch {
    checks.kb_manager = "down";
  }

  const status =
    Object.values(checks).every((v) => v === "ok") ? "ok" : "degraded";

  return json(
    {
      status,
      checks,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? "unknown",
    },
    { status: status === "ok" ? 200 : 503 }
  );
});