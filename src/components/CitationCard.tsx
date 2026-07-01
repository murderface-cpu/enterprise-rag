"use client";

import type { Citation } from "@/lib/types";

function ScoreDot({ score }: { score: number }) {
  const color =
    score >= 0.7
      ? "bg-green-400"
      : score >= 0.45
      ? "bg-yellow-400"
      : "bg-red-400";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

export function CitationCard({ citation }: { citation: Citation }) {
  return (
    <div className="rounded-lg border border-ink-100 bg-ink-50/60 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="shrink-0 font-mono font-semibold text-brand-600">[{citation.index}]</span>
          <span className="truncate text-ink-600" title={citation.source}>{citation.source}</span>
          <span className="text-ink-300">&middot;</span>
          <span className="shrink-0 text-ink-400">chunk {citation.chunkIndex}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-ink-400">
          <ScoreDot score={citation.score} />
          <span className={citation.score >= 0.7 ? "text-green-700" : citation.score >= 0.45 ? "text-yellow-700" : "text-red-700"}>
            {citation.score.toFixed(3)}
          </span>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-ink-600 line-clamp-2">{citation.snippet}...</p>
    </div>
  );
}
