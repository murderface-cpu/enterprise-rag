"use client";

import { useCallback, useEffect, useState } from "react";
import type { SystemMetrics } from "@/lib/types";

/** Lightweight client-side data hook with polling for live metrics. */
export function useMetrics(intervalMs = 5000) {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/metrics", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SystemMetrics;
      setMetrics(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const id = setInterval(fetchMetrics, intervalMs);
    return () => clearInterval(id);
  }, [fetchMetrics, intervalMs]);

  return { metrics, error, loading, refresh: fetchMetrics };
}