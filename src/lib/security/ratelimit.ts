/**
 * Rate limiting.
 *
 *   - Production: Upstash Ratelimit (works on Vercel serverless).
 *   - Mock / dev: an in-memory token bucket (per-instance).
 *
 * Fail-open: if the limiter itself errors (e.g. transient Upstash outage),
 * we let the request through and log a warning. Better to serve traffic
 * than to lock everyone out because of a quota service.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env, hasUpstashRedis } from "@/lib/env";
import { logger } from "@/lib/logger";

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Upstash-backed (production)
// ---------------------------------------------------------------------------

class UpstashLimiter {
  private readonly limiter: Ratelimit;
  constructor() {
    this.limiter = new Ratelimit({
      redis: new Redis({
        url: env.UPSTASH_REDIS_REST_URL!,
        token: env.UPSTASH_REDIS_REST_TOKEN!,
      }),
      limiter: Ratelimit.slidingWindow(env.RATE_LIMIT_PER_MINUTE, "1 m"),
      analytics: false,
      prefix: "rag:rl",
    });
  }

  async check(key: string): Promise<RateLimitResult> {
    const r = await this.limiter.limit(key);
    return {
      success: r.success,
      remaining: r.remaining,
      reset: r.reset,
      limit: r.limit,
    };
  }
}

// ---------------------------------------------------------------------------
// In-memory (mock / dev)
// ---------------------------------------------------------------------------

class InMemoryLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();
  private readonly capacity: number;
  private readonly refillPerMs: number;

  constructor(capacity: number, perMinute: number) {
    this.capacity = capacity;
    this.refillPerMs = capacity / (perMinute * 60_000);
  }

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updated: now };
    const elapsed = now - b.updated;
    const refilled = Math.min(this.capacity, b.tokens + elapsed * this.refillPerMs);
    const allowed = refilled >= 1;
    const remaining = Math.floor(allowed ? refilled - 1 : refilled);
    this.buckets.set(key, { tokens: allowed ? refilled - 1 : refilled, updated: now });
    return {
      success: allowed,
      remaining,
      reset: now + Math.ceil((1 / this.refillPerMs) * (allowed ? 1 : (1 - refilled))),
      limit: this.capacity,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let cached: UpstashLimiter | InMemoryLimiter | null = null;

function getLimiter(): UpstashLimiter | InMemoryLimiter {
  if (cached) return cached;
  if (hasUpstashRedis) {
    cached = new UpstashLimiter();
  } else {
    cached = new InMemoryLimiter(env.RATE_LIMIT_PER_MINUTE, env.RATE_LIMIT_PER_MINUTE);
  }
  return cached;
}

export async function rateLimit(key: string): Promise<RateLimitResult> {
  try {
    return await getLimiter().check(key);
  } catch (err) {
    logger.warn("rate_limit.error_fail_open", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: true, remaining: -1, reset: 0, limit: 0 };
  }
}