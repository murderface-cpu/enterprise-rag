/**
 * Shared helpers for Next.js API route handlers.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordRequest } from "@/lib/observability/metrics";
import { rateLimit } from "@/lib/security/ratelimit";
import { logger } from "@/lib/logger";
import { isMockMode } from "@/lib/env";

/** Standard JSON error response shape. */
export interface APIError {
  error: string;
  details?: unknown;
  traceId?: string;
}

/** Per-request context handed to every route handler. */
export interface RouteContext {
  /** Stable per-visitor session id. Documents are scoped to it so uploads
   *  from one browser session are never visible to another. */
  sessionId: string;
}

/** Cookie that carries the session id. httpOnly so client JS can't read it. */
export const SESSION_COOKIE = "sid";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function generateSessionId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `sess_${uuid.replace(/-/g, "")}`;
}

/** Wrap a handler with session resolution, rate limiting, errors, metrics. */
export function withRoute<T = unknown>(
  routeName: string,
  handler: (req: NextRequest, ctx: RouteContext) => Promise<NextResponse<T | APIError>>
) {
  return async (req: NextRequest): Promise<NextResponse<T | APIError>> => {
    const t0 = performance.now();
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "anonymous";

    // Resolve (or mint) the session id from the cookie.
    const existingSession = req.cookies.get(SESSION_COOKIE)?.value;
    const sessionId = existingSession || generateSessionId();
    const isNewSession = !existingSession;

    const finalize = (res: NextResponse<T | APIError>, errored: boolean) => {
      if (isNewSession) {
        res.cookies.set(SESSION_COOKIE, sessionId, {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: SESSION_MAX_AGE_SECONDS,
        });
      }
      recordRequest(routeName, performance.now() - t0, errored);
      return res;
    };

    // Rate limit per IP.
    const rl = await rateLimit(`${routeName}:${ip}`);
    if (!rl.success) {
      const res = NextResponse.json(
        { error: "Rate limit exceeded", details: { limit: rl.limit, reset: rl.reset } },
        { status: 429, headers: { "Retry-After": String(Math.max(1, rl.reset - Date.now())) } }
      );
      return finalize(res as NextResponse<T | APIError>, true);
    }

    try {
      const res = await handler(req, { sessionId });
      return finalize(res, res.status >= 500);
    } catch (err) {
      const traceId = req.headers.get("x-trace-id") ?? undefined;
      logger.error("route.unhandled_error", {
        route: routeName,
        method: req.method,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        traceId,
      });
      const res = NextResponse.json(
        { error: "Internal server error", traceId },
        { status: 500 }
      );
      return finalize(res as NextResponse<T | APIError>, true);
    }
  };
}

/** Parse JSON body safely with a Zod schema. Accepts empty body as `{}`. */
export async function parseBody<T>(
  req: NextRequest,
  schema: z.ZodSchema<T>
): Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  const text = await req.text();
  if (!text.trim()) {
    const parsed = schema.safeParse({});
    if (!parsed.success) {
      return {
        ok: false,
        res: NextResponse.json(
          { error: "Invalid request body", details: parsed.error.flatten() },
          { status: 400 }
        ),
      };
    }
    return { ok: true, data: parsed.data };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      res: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

/** Resolve the caller's IP for rate-limit buckets. */
export function callerKey(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "anonymous"
  );
}

/** Helpful CORS headers for the API. */
export function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Trace-Id",
  };
}

/** Common OPTIONS preflight handler. */
export function optionsHandler() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export function json<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, { headers: corsHeaders(), ...init });
}

export { isMockMode };