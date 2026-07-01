/**
 * Structured logger with per-request trace IDs.
 *
 * Output is JSON in production and pretty in development so it's
 * readable in both `vercel logs` and the local terminal.
 */

import { env } from "@/lib/env";

type LogLevel = "debug" | "info" | "warn" | "error";

const COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const RESET = "\x1b[0m";

export interface LogContext {
  traceId?: string;
  route?: string;
  method?: string;
  userId?: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, ctx: LogContext = {}): void {
  const timestamp = new Date().toISOString();
  const base = { level, timestamp, message, ...ctx };

  if (env.NODE_ENV === "production") {
    // Structured single-line JSON: easy for log shippers to ingest.
    // eslint-disable-next-line no-console
    console[level === "debug" ? "log" : level](JSON.stringify(base));
    return;
  }

  const color = COLORS[level];
  const ctxStr = Object.keys(ctx).length ? ` ${JSON.stringify(ctx)}` : "";
  // eslint-disable-next-line no-console
  console.log(
    `${color}[${timestamp}] [${level.toUpperCase()}]${RESET} ${message}${ctxStr}`
  );
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: LogContext) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext) => emit("error", msg, ctx),
};

/**
 * Generate a short trace ID for a request. Used to correlate logs from
 * a single user action across ingestion, embedding, retrieval, and LLM.
 */
export function newTraceId(): string {
  return `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}