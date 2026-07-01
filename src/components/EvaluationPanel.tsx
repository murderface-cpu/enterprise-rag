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
  topK: number;
  timestamp: string;
}

export function EvaluationPanel() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EvalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/evaluate", { method: "POST" });
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
    <div className="card p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Evaluation</h2>
          <p className="text-xs text-ink-500">
            Runs the built-in eval corpus through the pipeline and reports retrieval + generation metrics.
          </p>
        </div>
        <button onClick={run} disabled={running} className="btn-primary">
          {running ? "Running…" : "Run evaluation"}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {!result && !error && (
        <p className="rounded-md bg-ink-50 px-3 py-6 text-center text-xs text-ink-500">
          Click <strong>Run evaluation</strong> to populate this panel.
        </p>
      )}

      {result && (
        <div className="space-y-4">
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

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-900">Per-query breakdown</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-ink-200 text-left text-ink-500">
                    <th className="px-2 py-2 font-medium">Question</th>
                    <th className="px-2 py-2 font-medium text-right">Recall</th>
                    <th className="px-2 py-2 font-medium text-right">MRR</th>
                    <th className="px-2 py-2 font-medium text-right">nDCG</th>
                    <th className="px-2 py-2 font-medium text-right">Hits</th>
                    <th className="px-2 py-2 font-medium text-right">Latency</th>
                    <th className="px-2 py-2 font-medium text-right">Cit. prec.</th>
                  </tr>
                </thead>
                <tbody>
                  {result.perQuery.map((row, i) => (
                    <tr key={i} className="border-b border-ink-100">
                      <td className="px-2 py-2 text-ink-800">{row.question}</td>
                      <td className="px-2 py-2 text-right font-mono">{row.retrieval.recall_at_k.toFixed(2)}</td>
                      <td className="px-2 py-2 text-right font-mono">{row.retrieval.mrr.toFixed(2)}</td>
                      <td className="px-2 py-2 text-right font-mono">{row.retrieval.ndcg_at_k.toFixed(2)}</td>
                      <td className="px-2 py-2 text-right font-mono">{row.retrieval.hits_at_k}</td>
                      <td className="px-2 py-2 text-right font-mono">{row.latencyMs.toFixed(0)} ms</td>
                      <td className="px-2 py-2 text-right font-mono">{row.citationPrecision.toFixed(2)}</td>
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

function Metric({ label, value, tone }: { label: string; value: string; tone?: "green" | "yellow" | "red" }) {
  const toneClass =
    tone === "green" ? "text-green-700" : tone === "yellow" ? "text-yellow-700" : tone === "red" ? "text-red-700" : "text-ink-900";
  return (
    <div className="rounded-lg border border-ink-100 bg-ink-50/40 px-3 py-2">
      <p className="text-xs text-ink-500">{label}</p>
      <p className={`text-lg font-semibold ${toneClass}`}>{value}</p>
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