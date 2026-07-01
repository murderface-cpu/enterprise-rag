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
      <header className="sticky top-0 z-20 border-b border-ink-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-semibold text-ink-900 sm:text-base">Scalable Enterprise RAG</h1>
              <p className="hidden text-[11px] text-ink-400 sm:block">Gemini &middot; Upstash Vector &middot; Hybrid retrieval</p>
            </div>
          </div>
          <nav className="flex items-center gap-2 text-xs">
            <a
              href="/api/health"
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1 rounded-md border border-ink-200 px-2.5 py-1.5 text-ink-600 transition hover:bg-ink-50 sm:flex"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
              Health
            </a>
            <a
              href="/api/metrics"
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-md border border-ink-200 px-2.5 py-1.5 text-ink-600 transition hover:bg-ink-50 sm:block"
            >
              Metrics
            </a>
            <a
              href="https://github.com/murderface-cpu/enterprise-rag"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-md border border-ink-200 px-2.5 py-1.5 text-ink-600 transition hover:bg-ink-50"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
              </svg>
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 space-y-5 sm:px-6">
        <StatsBar />

        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-ink-200">
          <TabButton label="Chat" active={tab === "chat"} onClick={() => setTab("chat")} />
          <TabButton label="Evaluation" active={tab === "evaluate"} onClick={() => setTab("evaluate")} />
        </div>

        {tab === "chat" && (
          <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
            <KnowledgeBasePanel onChange={() => setKbTick((t) => t + 1)} key={kbTick} />
            <ChatPanel key={kbTick} />
          </div>
        )}

        {tab === "evaluate" && <EvaluationPanel />}
      </main>

      <footer className="mx-auto max-w-7xl border-t border-ink-100 px-6 py-4 text-center text-xs text-ink-400">
        Every answer is grounded in retrieved context and ships with citations, latency, and confidence.
      </footer>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-brand-600 text-brand-700"
          : "border-transparent text-ink-500 hover:text-ink-800"
      }`}
    >
      {label}
    </button>
  );
}
