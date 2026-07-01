/**
 * Lightweight in-process metrics.
 *
 * On Vercel, each serverless instance has its own memory, so this is
 * best-effort — it gives you *current-instance* traffic and latency stats
 * that surface on /api/metrics and /api/health. For production-grade
 * observability, point the same logs at an external service (Axiom,
 * Datadog, etc.). Structured JSON logs are already emitted by `logger`.
 */

interface RouteStats {
  count: number;
  totalLatencyMs: number;
  errors: number;
}

const routes = new Map<string, RouteStats>();

export function recordRequest(route: string, latencyMs: number, errored = false): void {
  const existing = routes.get(route) ?? { count: 0, totalLatencyMs: 0, errors: 0 };
  existing.count += 1;
  existing.totalLatencyMs += latencyMs;
  if (errored) existing.errors += 1;
  routes.set(route, existing);
}

export function snapshot(): {
  requestCounts: Record<string, number>;
  averageLatencyMs: Record<string, number>;
  errorRate: Record<string, number>;
  uptimeSeconds: number;
} {
  const startedAt = processStartedAt;
  const requestCounts: Record<string, number> = {};
  const averageLatencyMs: Record<string, number> = {};
  const errorRate: Record<string, number> = {};

  for (const [route, stats] of routes.entries()) {
    requestCounts[route] = stats.count;
    averageLatencyMs[route] = stats.count === 0 ? 0 : stats.totalLatencyMs / stats.count;
    errorRate[route] = stats.count === 0 ? 0 : stats.errors / stats.count;
  }

  return {
    requestCounts,
    averageLatencyMs,
    errorRate,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  };
}

const processStartedAt = Date.now();

/** Reset for tests. */
export function resetMetrics(): void {
  routes.clear();
}