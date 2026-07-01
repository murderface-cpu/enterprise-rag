"use client";

import type { Citation } from "@/lib/types";

export function CitationCard({ citation }: { citation: Citation }) {
  return (
    <div className="rounded-lg border border-ink-100 bg-ink-50/40 px-3 py-2">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-mono text-ink-500">[{citation.index}]</span>
        <span className="flex items-center gap-2 text-ink-500">
          <span>{citation.source}</span>
          <span>·</span>
          <span>chunk {citation.chunkIndex}</span>
          <span>·</span>
          <span className={citation.score >= 0.7 ? "text-green-700" : citation.score >= 0.45 ? "text-yellow-700" : "text-red-700"}>
            score {citation.score.toFixed(3)}
          </span>
        </span>
      </div>
      <p className="text-xs text-ink-700">{citation.snippet}…</p>
    </div>
  );
}