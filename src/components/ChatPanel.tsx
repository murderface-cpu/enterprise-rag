"use client";

import { useEffect, useRef, useState } from "react";
import type { RAGResponse } from "@/lib/types";
import { CitationCard } from "@/components/CitationCard";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  response?: RAGResponse;
  pending?: boolean;
  error?: string;
}

const SAMPLE_QUESTIONS = [
  "What is RAG and how does it work?",
  "How does hybrid retrieval improve accuracy?",
  "What file formats are supported for ingestion?",
];

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(6);
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const submit = async (q?: string) => {
    const text = (q ?? question).trim();
    if (!text || submitting) return;
    const userMsg: ChatMessage = {
      id: `m_${Date.now()}`,
      role: "user",
      text,
    };
    const pendingId = `m_${Date.now() + 1}`;
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: pendingId, role: "assistant", text: "", pending: true },
    ]);
    setQuestion("");
    setSubmitting(true);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, topK }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RAGResponse;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId ? { ...m, response: data, pending: false } : m
        )
      );
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? { ...m, pending: false, error: e instanceof Error ? e.message : "Failed" }
            : m
        )
      );
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="card flex h-[calc(100vh-220px)] flex-col">
      {/* Panel header */}
      <div className="border-b border-ink-100 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink-900">Ask the knowledge base</h2>
            <p className="text-xs text-ink-500">Grounded answers with citations and observability.</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-500" htmlFor="topk-select">Top-K</label>
            <select
              id="topk-select"
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              className="rounded border border-ink-200 bg-white px-2 py-1 text-xs text-ink-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {[3, 5, 6, 8, 10, 12].map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Message area */}
      <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-5 py-10 text-center">
            <div className="rounded-full border border-ink-100 bg-ink-50 p-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-ink-700">No messages yet</p>
              <p className="text-xs text-ink-500">Ask anything from the uploaded documents.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => submit(q)}
                  disabled={submitting}
                  className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {m.role === "assistant" && (
              <div className="mr-2 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                m.role === "user"
                  ? "rounded-tr-sm bg-brand-600 text-white shadow-sm"
                  : "rounded-tl-sm border border-ink-100 bg-white text-ink-900 shadow-sm"
              }`}
            >
              {m.role === "user" ? (
                <p className="whitespace-pre-wrap">{m.text}</p>
              ) : m.pending ? (
                <div className="flex items-center gap-1.5 text-ink-400">
                  <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-ink-300" />
                  <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-ink-300 [animation-delay:0.15s]" />
                  <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-ink-300 [animation-delay:0.3s]" />
                  <span className="ml-1 text-xs">Generating answer...</span>
                </div>
              ) : m.error ? (
                <p className="flex items-center gap-1.5 text-red-600">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  {m.error}
                </p>
              ) : m.response ? (
                <div className="space-y-3">
                  <p className="whitespace-pre-wrap leading-relaxed">{m.response.answer}</p>
                  {m.response.citations.length > 0 && (
                    <div className="border-t border-ink-100 pt-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
                        Sources
                      </p>
                      <div className="space-y-1.5">
                        {m.response.citations.map((c) => (
                          <CitationCard key={c.index} citation={c} />
                        ))}
                      </div>
                    </div>
                  )}
                  <ObservabilityRow obs={m.response.observability} />
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {/* Input bar */}
      <div className="border-t border-ink-100 bg-ink-50/30 px-4 py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-center gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about your documents..."
            className="input flex-1"
            disabled={submitting}
          />
          <button
            type="submit"
            className="btn-primary shrink-0"
            disabled={submitting || !question.trim()}
          >
            {submitting ? (
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

function ObservabilityRow({
  obs,
}: {
  obs: RAGResponse["observability"];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink-100 pt-2.5 text-[11px] text-ink-400">
      <ConfidenceBadge level={obs.confidence} />
      <span>{obs.numRetrieved} chunks</span>
      <span>retrieve {obs.retrievalLatencyMs.toFixed(0)} ms</span>
      <span>generate {obs.generationLatencyMs.toFixed(0)} ms</span>
      <span
        className="max-w-[120px] truncate font-mono text-[10px]"
        title={`Trace: ${obs.traceId}`}
      >
        {obs.traceId}
      </span>
    </div>
  );
}

function ConfidenceBadge({ level }: { level: "low" | "medium" | "high" }) {
  if (level === "high") return <span className="badge-green">High confidence</span>;
  if (level === "medium") return <span className="badge-yellow">Medium confidence</span>;
  return <span className="badge-red">Low confidence</span>;
}
