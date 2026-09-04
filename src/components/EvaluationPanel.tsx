"use client";

import { useState } from "react";

interface EvalSummary {
  numQueries: number;
  avgRecallAtK: number;
  avgMRR: number;
  avgNDCGAtK: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgCitationPrecision: number;
  groundedOnlyFraction: number;
}

interface PerQueryRow {
  question: string;
  retrieval: { recall_at_k: number; mrr: number; ndcg_at_k: number; hits_at_k: number };
  latencyMs: number;
  citationPrecision: number;
  grounded: boolean;
  answer: string;
}

interface EvalResponse {
  summary: EvalSummary;
  perQuery: PerQueryRow[];
  corpusSize: number;
  corpusSource?: "custom" | "kb" | "default";
  topK: number;
  timestamp: string;
}

const CORPUS_SOURCE_LABEL: Record<string, string> = {
  kb: "Generated from your uploaded documents",
  default: "Built-in sample corpus (upload documents to evaluate your own)",
  custom: "Custom corpus supplied in the request",
};

const NUM_QUERIES_OPTIONS = [3, 6, 10, 15, 20, 25];
const TOP_K_OPTIONS = [3, 5, 6, 8, 10, 12, 16, 20];

export function EvaluationPanel() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EvalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [numQueries, setNumQueries] = useState(6);
  const [topK, setTopK] = useState(8);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numQueries, topK }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as EvalResponse;
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evaluation failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Evaluation</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Generates an eval set from your uploaded documents and reports retrieval and generation metrics.
          </p>
          {result && (
            <>
              <p className="mt-1 text-[11px] text-ink-400">
                Last run: {new Date(result.timestamp).toLocaleString()} &middot; {result.corpusSize} queries &middot; Top-K {result.topK}
              </p>
              {result.corpusSource && (
                <span
                  className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    result.corpusSource === "kb"
                      ? "bg-green-100 text-green-800"
                      : "bg-yellow-100 text-yellow-800"
                  }`}
                >
                  {CORPUS_SOURCE_LABEL[result.corpusSource] ?? result.corpusSource}
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-ink-500" htmlFor="eval-numqueries">
              Eval scale (queries)
            </label>
            <select
              id="eval-numqueries"
              value={numQueries}
              onChange={(e) => setNumQueries(Number(e.target.value))}
              disabled={running}
              title="Number of documents sampled into a KB-derived eval set. Ignored if you're on the default sample corpus."
              className="rounded border border-ink-200 bg-white px-2 py-1 text-xs text-ink-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {NUM_QUERIES_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-ink-500" htmlFor="eval-topk">
              Top-K
            </label>
            <select
              id="eval-topk"
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              disabled={running}
              className="rounded border border-ink-200 bg-white px-2 py-1 text-xs text-ink-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {TOP_K_OPTIONS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <button
            onClick={run}
            disabled={running}
            className="btn-primary shrink-0"
          >
            {running ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Running...
              </span>
            ) : (
              "Run evaluation"
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <svg className="mt-0.5 shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      {!result && !error && !running && (
        <div className="rounded-lg border border-dashed border-ink-200 bg-ink-50/30 py-10 text-center">
          <p className="text-sm text-ink-500">
            Click <strong className="text-ink-700">Run evaluation</strong> to populate this panel.
          </p>
        </div>
      )}

      {running && !result && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-ink-100 bg-ink-50/40 px-3 py-2">
              <div className="skeleton mb-2 h-3 w-16 rounded" />
              <div className="skeleton h-6 w-12 rounded" />
            </div>
          ))}
        </div>
      )}

      {result && (
        <div className="space-y-5">
          {/* Summary metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Queries" value={result.summary.numQueries.toString()} />
            <Metric
              label="Recall@K"
              value={result.summary.avgRecallAtK.toFixed(3)}
              tone={metricTone(result.summary.avgRecallAtK, 0.7, 0.4)}
            />
            <Metric
              label="MRR"
              value={result.summary.avgMRR.toFixed(3)}
              tone={metricTone(result.summary.avgMRR, 0.7, 0.4)}
            />
            <Metric
              label="nDCG@K"
              value={result.summary.avgNDCGAtK.toFixed(3)}
              tone={metricTone(result.summary.avgNDCGAtK, 0.7, 0.4)}
            />
            <Metric
              label="Latency p50"
              value={`${result.summary.p50LatencyMs.toFixed(0)} ms`}
              tone={metricToneReverse(result.summary.p50LatencyMs, 1500, 4000)}
            />
            <Metric
              label="Latency p95"
              value={`${result.summary.p95LatencyMs.toFixed(0)} ms`}
              tone={metricToneReverse(result.summary.p95LatencyMs, 3000, 8000)}
            />
            <Metric
              label="Citation precision"
              value={result.summary.avgCitationPrecision.toFixed(3)}
              tone={metricTone(result.summary.avgCitationPrecision, 0.7, 0.4)}
            />
            <Metric
              label="Grounded"
              value={`${(result.summary.groundedOnlyFraction * 100).toFixed(0)}%`}
              tone={metricTone(result.summary.groundedOnlyFraction, 0.95, 0.7)}
            />
          </div>

          {/* Per-query breakdown */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-900">Per-query breakdown</h3>
            <div className="overflow-x-auto rounded-lg border border-ink-100">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50/60 text-left text-ink-500">
                    <th className="px-3 py-2.5 font-semibold">Question</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Recall</th>
                    <th className="px-3 py-2.5 text-right font-semibold">MRR</th>
                    <th className="px-3 py-2.5 text-right font-semibold">nDCG</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Hits</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Latency</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Cit. prec.</th>
                  </tr>
                </thead>
                <tbody>
                  {result.perQuery.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-ink-100 transition-colors last:border-0 hover:bg-ink-50/50"
                    >
                      <td className="px-3 py-2.5 text-ink-800">{row.question}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-ink-700">{row.retrieval.recall_at_k.toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-ink-700">{row.retrieval.mrr.toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-ink-700">{row.retrieval.ndcg_at_k.toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-ink-700">{row.retrieval.hits_at_k}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-ink-700">{row.latencyMs.toFixed(0)} ms</td>
                      <td className="px-3 py-2.5 text-right font-mono text-ink-700">{row.citationPrecision.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "yellow" | "red";
}) {
  const valueClass =
    tone === "green"
      ? "text-green-700"
      : tone === "yellow"
      ? "text-yellow-700"
      : tone === "red"
      ? "text-red-700"
      : "text-ink-900";
  return (
    <div className="rounded-lg border border-ink-100 bg-ink-50/40 px-3 py-2.5 transition-shadow hover:shadow-sm">
      <p className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );
}

function metricTone(v: number, good: number, bad: number): "green" | "yellow" | "red" {
  if (v >= good) return "green";
  if (v >= bad) return "yellow";
  return "red";
}

function metricToneReverse(v: number, good: number, bad: number): "green" | "yellow" | "red" {
  if (v <= good) return "green";
  if (v <= bad) return "yellow";
  return "red";
}
