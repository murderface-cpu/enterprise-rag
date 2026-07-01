"use client";

import { useMetrics } from "@/hooks/useMetrics";

export function StatsBar() {
  const { metrics, loading, error } = useMetrics(5000);

  if (loading && !metrics) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card px-3 py-2">
            <div className="skeleton mb-1 h-3 w-16 rounded" />
            <div className="skeleton h-4 w-10 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      <Stat label="Documents" value={metrics?.totalDocuments.toString() ?? "-"} />
      <Stat label="Chunks" value={metrics?.totalChunks.toString() ?? "-"} />
      <Stat label="Vector size" value={metrics?.vectorStoreSize.toString() ?? "-"} />
      <Stat label="Top-K" value={metrics?.topK.toString() ?? "-"} />
      <Stat label="Embeddings" value={metrics?.embeddingModel ?? "-"} />
      <Stat
        label="LLM"
        value={metrics?.llmModel.split("/").pop() ?? "-"}
        hint={metrics?.isMockMode ? "mock mode" : undefined}
      />
      {error && (
        <div className="col-span-full rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
          Metrics endpoint unavailable: {error}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card px-3 py-2 transition-shadow hover:shadow-sm">
      <p className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className="truncate text-sm font-semibold text-ink-900" title={value}>{value}</p>
      {hint && (
        <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-amber-600">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
          {hint}
        </span>
      )}
    </div>
  );
}
