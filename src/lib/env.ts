/**
 * Environment configuration and validation.
 *
 * Validation runs lazily; module import does NOT throw, so Next.js can
 * build even when env vars are missing. The first call to `requireEnv()`
 * will throw with a friendly message if required vars are absent.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const envSchema = z.object({
  // --- Required ---
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),

  // --- Optional but recommended (managed by Vercel/Upstash) ---
  UPSTASH_VECTOR_REST_URL: z.string().url().optional(),
  UPSTASH_VECTOR_REST_TOKEN: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // --- Embedding / chunking knobs (safe defaults) ---
  EMBEDDING_MODEL: z.string().default("text-embedding-004"),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(768),
  CHUNK_SIZE: z.coerce.number().int().positive().default(800),
  CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(120),

  // --- LLM knobs ---
  LLM_MODEL: z.string().default("gemini-1.5-flash"),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1024),

  // --- Groq (OpenAI-compatible) LLM ---
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("openai/gpt-oss-20b"),
  GROQ_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),

  // --- Retrieval knobs ---
  TOP_K: z.coerce.number().int().positive().default(8),
  MIN_RELEVANCE_SCORE: z.coerce.number().min(0).max(1).default(0.5),

  // --- Behavior toggles ---
  ALLOW_MOCK_MODE: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() === "true"),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),

  // --- Misc ---
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

// ---------------------------------------------------------------------------
// Parsed env: schema is built, but parsing happens lazily so missing
// required env vars don't break `next build`.
// ---------------------------------------------------------------------------

const parsed = envSchema.safeParse(process.env);
const parseError = parsed.success
  ? null
  : parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");

/**
 * Get the validated env, throwing if any required var is missing.
 * Call this from runtime code (API routes, server components), not at
 * top level of an imported module.
 */
export function requireEnv() {
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("[env] Invalid configuration:\n" + parseError);
    throw new Error("Invalid environment configuration");
  }
  return parsed.data;
}

/** Best-effort access; returns sensible defaults if config is invalid. */
export const env = parsed.success
  ? parsed.data
  : ({
      GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
      UPSTASH_VECTOR_REST_URL: process.env.UPSTASH_VECTOR_REST_URL,
      UPSTASH_VECTOR_REST_TOKEN: process.env.UPSTASH_VECTOR_REST_TOKEN,
      UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
      EMBEDDING_MODEL: process.env.EMBEDDING_MODEL ?? "text-embedding-004",
      EMBEDDING_DIM: Number(process.env.EMBEDDING_DIM ?? 768),
      CHUNK_SIZE: Number(process.env.CHUNK_SIZE ?? 800),
      CHUNK_OVERLAP: Number(process.env.CHUNK_OVERLAP ?? 120),
      LLM_MODEL: process.env.LLM_MODEL ?? "gemini-1.5-flash",
      LLM_TEMPERATURE: Number(process.env.LLM_TEMPERATURE ?? 0.2),
      LLM_MAX_OUTPUT_TOKENS: Number(process.env.LLM_MAX_OUTPUT_TOKENS ?? 1024),
      GROQ_API_KEY: process.env.GROQ_API_KEY,
      GROQ_MODEL: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
      GROQ_BASE_URL: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
      TOP_K: Number(process.env.TOP_K ?? 8),
      MIN_RELEVANCE_SCORE: Number(process.env.MIN_RELEVANCE_SCORE ?? 0.5),
      ALLOW_MOCK_MODE: (process.env.ALLOW_MOCK_MODE ?? "true").toLowerCase() === "true",
      RATE_LIMIT_PER_MINUTE: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 60),
      NODE_ENV: (process.env.NODE_ENV as "development" | "production" | "test") ?? "development",
    } as z.infer<typeof envSchema>);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when managed Upstash credentials are present. */
export const hasUpstashVector = Boolean(env.UPSTASH_VECTOR_REST_URL && env.UPSTASH_VECTOR_REST_TOKEN);
export const hasUpstashRedis = Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);

/** True when a Groq API key is configured. Groq powers answer generation
 *  even without Gemini, so it takes precedence over the extractive MockLLM. */
export const hasGroq = Boolean(env.GROQ_API_KEY);

/**
 * Mock mode kicks in automatically when:
 *   - ALLOW_MOCK_MODE is true (default), AND
 *   - we're not in production, OR
 *   - we're in production but managed services / Gemini key are missing.
 *
 * The intent: local dev / CI never crashes because of missing secrets,
 * but production without secrets still runs (with a clear badge in the UI).
 */
export const isMockMode =
  env.ALLOW_MOCK_MODE &&
  (env.NODE_ENV !== "production" || !hasUpstashVector || !env.GEMINI_API_KEY);