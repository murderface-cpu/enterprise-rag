"use client";

import type { ReactNode } from "react";

/**
 * Minimal, dependency-free renderer for LLM answers.
 *
 * The system prompts constrain the model to a small Markdown subset
 * (## headers, - bullets, **bold**, [n] citations) — enough structure for
 * "deep" mode insight briefs without pulling in a full markdown library.
 * Anything outside that subset just renders as plain text.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*)|(\[\d+\])/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      parts.push(
        <strong key={`${keyPrefix}-b-${i++}`} className="font-semibold text-ink-900">
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      parts.push(
        <sup
          key={`${keyPrefix}-c-${i++}`}
          className="mx-0.5 rounded bg-brand-50 px-1 py-0.5 text-[10px] font-semibold text-brand-700"
        >
          {token.slice(1, -1)}
        </sup>
      );
    }
    last = regex.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function AnswerText({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let listBuffer: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listBuffer.length === 0) return;
    const items = listBuffer;
    listBuffer = [];
    blocks.push(
      <ul key={`ul-${key++}`} className="list-disc space-y-1 pl-5 marker:text-ink-300">
        {items.map((item, i) => (
          <li key={i}>{renderInline(item, `li-${key}-${i}`)}</li>
        ))}
      </ul>
    );
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    if (line.startsWith("## ")) {
      flushList();
      blocks.push(
        <h4
          key={`h-${key++}`}
          className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500 first:pt-0"
        >
          {line.slice(3)}
        </h4>
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      listBuffer.push(line.slice(2));
    } else {
      flushList();
      blocks.push(
        <p key={`p-${key++}`} className="leading-relaxed">
          {renderInline(line, `p-${key}`)}
        </p>
      );
    }
  }
  flushList();

  return <div className="space-y-2">{blocks}</div>;
}
