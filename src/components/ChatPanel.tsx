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

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(6);
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const submit = async () => {
    if (!question.trim() || submitting) return;
    const userMsg: ChatMessage = {
      id: `m_${Date.now()}`,
      role: "user",
      text: question.trim(),
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
        body: JSON.stringify({ question: userMsg.text, topK }),
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
    }
  };

  return (
    <div className="card flex h-[calc(100vh-220px)] flex-col">
      <div className="border-b border-ink-100 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink-900">Ask the knowledge base</h2>
            <p className="text-xs text-ink-500">Grounded answers with citations and observability.</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-500">Top-K</label>
            <select
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              className="rounded border border-ink-200 bg-white px-2 py-1 text-xs"
            >
              {[3, 5, 6, 8, 10, 12].map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="rounded-lg border border-dashed border-ink-200 bg-ink-50/40 px-4 py-8 text-center text-sm text-ink-500">
            Ask a question to get started. Try something from the seeded corpus.
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${
                m.role === "user"
                  ? "bg-brand-600 text-white"
                  : "border border-ink-100 bg-white text-ink-900"
              }`}
            >
              {m.role === "user" ? (
                <p className="whitespace-pre-wrap">{m.text}</p>
              ) : m.pending ? (
                <div className="flex items-center gap-2 text-ink-500">
                  <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-ink-400" />
                  <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-ink-400 [animation-delay:0.15s]" />
                  <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-ink-400 [animation-delay:0.3s]" />
                  <span className="text-xs">Generating grounded answer…</span>
                </div>
              ) : m.error ? (
                <p className="text-red-600">Error: {m.error}</p>
              ) : m.response ? (
                <div className="space-y-3">
                  <p className="whitespace-pre-wrap leading-relaxed">{m.response.answer}</p>
                  {m.response.citations.length > 0 && (
                    <div className="border-t border-ink-100 pt-3">
                      <p className="mb-2 text-xs font-medium text-ink-500">Citations</p>
                      <div className="space-y-2">
                        {m.response.citations.map((c) => (
                          <CitationCard key={c.index} citation={c} />
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3 text-xs text-ink-500">
                    <span>Trace <code className="rounded bg-ink-100 px-1 text-[10px]">{m.response.observability.traceId}</code></span>
                    <span>·</span>
                    <span>Retrieval {m.response.observability.retrievalLatencyMs.toFixed(0)}ms</span>
                    <span>·</span>
                    <span>Generation {m.response.observability.generationLatencyMs.toFixed(0)}ms</span>
                    <span>·</span>
                    <span>{m.response.observability.numRetrieved} chunks</span>
                    <span>·</span>
                    <ConfidenceBadge level={m.response.observability.confidence} />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-ink-100 px-4 py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question…"
            className="input flex-1"
            disabled={submitting}
          />
          <button type="submit" className="btn-primary" disabled={submitting || !question.trim()}>
            Ask
          </button>
        </form>
      </div>
    </div>
  );
}

function ConfidenceBadge({ level }: { level: "low" | "medium" | "high" }) {
  if (level === "high") return <span className="badge-green">High confidence</span>;
  if (level === "medium") return <span className="badge-yellow">Medium confidence</span>;
  return <span className="badge-red">Low confidence</span>;
}