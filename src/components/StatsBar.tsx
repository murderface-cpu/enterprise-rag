"use client";

import { useMetrics } from "@/hooks/useMetrics";

export function StatsBar() {
  const { metrics, loading, error } = useMetrics(5000);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      <Stat label="Documents" value={metrics?.totalDocuments.toString() ?? "—"} />
      <Stat label="Chunks" value={metrics?.totalChunks.toString() ?? "—"} />
      <Stat label="Vector size" value={metrics?.vectorStoreSize.toString() ?? "—"} />
      <Stat label="Top-K" value={metrics?.topK.toString() ?? "—"} />
      <Stat label="Embeddings" value={metrics?.embeddingModel ?? "—"} />
      <Stat
        label="LLM"
        value={metrics?.llmModel.split("/").pop() ?? "—"}
        hint={metrics?.isMockMode ? "mock mode" : undefined}
      />
      {error && (
        <div className="col-span-full rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
          Metrics endpoint unavailable: {error}
        </div>
      )}
      {loading && !metrics && (
        <div className="col-span-full text-xs text-ink-500">Loading system metrics…</div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card px-3 py-2">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="truncate text-sm font-semibold text-ink-900" title={value}>{value}</p>
      {hint && <p className="text-[10px] uppercase tracking-wide text-yellow-700">{hint}</p>}
    </div>
  );
}