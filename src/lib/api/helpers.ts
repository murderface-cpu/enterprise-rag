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

/** Wrap a handler with rate limiting, error handling, and metrics. */
export function withRoute<T = unknown>(
  routeName: string,
  handler: (req: NextRequest) => Promise<NextResponse<T | APIError>>
) {
  return async (req: NextRequest): Promise<NextResponse<T | APIError>> => {
    const t0 = performance.now();
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "anonymous";

    // Rate limit per IP.
    const rl = await rateLimit(`${routeName}:${ip}`);
    if (!rl.success) {
      const res = NextResponse.json(
        { error: "Rate limit exceeded", details: { limit: rl.limit, reset: rl.reset } },
        { status: 429, headers: { "Retry-After": String(Math.max(1, rl.reset - Date.now())) } }
      );
      recordRequest(routeName, performance.now() - t0, true);
      return res as NextResponse<T | APIError>;
    }

    try {
      const res = await handler(req);
      recordRequest(routeName, performance.now() - t0, res.status >= 500);
      return res;
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
      recordRequest(routeName, performance.now() - t0, true);
      return res as NextResponse<T | APIError>;
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