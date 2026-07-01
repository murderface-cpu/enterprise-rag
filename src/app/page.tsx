"use client";

import { useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { KnowledgeBasePanel } from "@/components/KnowledgeBasePanel";
import { EvaluationPanel } from "@/components/EvaluationPanel";
import { StatsBar } from "@/components/StatsBar";

type Tab = "chat" | "evaluate";

export default function HomePage() {
  const [tab, setTab] = useState<Tab>("chat");
  const [kbTick, setKbTick] = useState(0);

  return (
    <div className="min-h-screen bg-ink-50/40">
      {/* Header */}
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-ink-900">Scalable Enterprise RAG</h1>
              <p className="text-xs text-ink-500">Production-grade · Gemini · Upstash Vector · Hybrid retrieval</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-ink-500">
            <a
              href="/api/health"
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-ink-200 px-2 py-1 hover:bg-ink-50"
            >
              /api/health
            </a>
            <a
              href="/api/metrics"
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-ink-200 px-2 py-1 hover:bg-ink-50"
            >
              /api/metrics
            </a>
            <a
              href="https://github.com/murderface-cpu/enterprise-rag"
              target="_blank"
              rel="noreferrer"
              className="text-ink-500 hover:text-ink-900"
            >
              GitHub ↗
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        <StatsBar />

        <div className="flex items-center gap-2 border-b border-ink-200">
          <button
            onClick={() => setTab("chat")}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === "chat"
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-ink-500 hover:text-ink-900"
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => setTab("evaluate")}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === "evaluate"
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-ink-500 hover:text-ink-900"
            }`}
          >
            Evaluation
          </button>
        </div>

        {tab === "chat" && (
          <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
            <KnowledgeBasePanel onChange={() => setKbTick((t) => t + 1)} key={kbTick} />
            <ChatPanel key={kbTick} />
          </div>
        )}

        {tab === "evaluate" && <EvaluationPanel />}
      </main>

      <footer className="mx-auto max-w-7xl px-6 py-6 text-center text-xs text-ink-400">
        <p>
          Every answer is grounded in retrieved context and ships with citations, latency, and confidence.
        </p>
      </footer>
    </div>
  );
}