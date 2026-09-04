/**
 * LLM layer.
 *
 *   - GeminiLLM:  production, grounded answer generation with citations.
 *   - MockLLM:    extractive fallback for mock mode. Picks salient sentences
 *                 from retrieved context and returns them as the answer.
 *
 * Both expose the same `generate()` interface so the pipeline doesn't branch.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { env, isMockMode, hasGroq, hasGemini } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { ResponseMode, RetrievalHit } from "@/lib/types";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface LLMOptions {
  temperature?: number;
  maxOutputTokens?: number;
  responseMode?: ResponseMode;
}

/**
 * Token budget per response depth, scaled off the operator-configured
 * "standard" baseline (LLM_MAX_OUTPUT_TOKENS) so a deployment that raises
 * or lowers its default proportionally raises/lowers concise & deep too.
 */
export const RESPONSE_MODE_TOKENS: Record<ResponseMode, number> = {
  concise: Math.max(256, Math.round(env.LLM_MAX_OUTPUT_TOKENS * 0.35)),
  standard: env.LLM_MAX_OUTPUT_TOKENS,
  deep: Math.max(3072, env.LLM_MAX_OUTPUT_TOKENS * 3),
};

/** Resolve the effective max-output-tokens for a generation call. */
function resolveMaxOutputTokens(options?: LLMOptions): number {
  if (options?.maxOutputTokens) return options.maxOutputTokens;
  return RESPONSE_MODE_TOKENS[options?.responseMode ?? "standard"];
}

export interface GenerationContext {
  question: string;
  hits: RetrievalHit[];
  options?: LLMOptions;
}

export interface GenerationResult {
  text: string;
  groundedOnly: boolean;
  citationsUsed: number[];
}

export interface BaseLLM {
  readonly modelName: string;
  generate(ctx: GenerationContext): Promise<GenerationResult>;
}

// ---------------------------------------------------------------------------
// Mock LLM (extractive, for dev/test)
// ---------------------------------------------------------------------------

export class MockLLM implements BaseLLM {
  readonly modelName = "mock-extractive-v1";

  async generate(ctx: GenerationContext): Promise<GenerationResult> {
    const { question, hits, options } = ctx;
    if (hits.length === 0) {
      return { text: "I don't know based on the provided context.", groundedOnly: true, citationsUsed: [] };
    }

    // Response depth still matters in mock mode: "deep" pulls more sentences
    // per hit and covers more hits, so the length knob is visible even
    // without a real LLM configured.
    const mode = options?.responseMode ?? "standard";
    const perHitSentences = mode === "deep" ? 3 : mode === "concise" ? 1 : 2;
    const maxSentences = mode === "deep" ? 10 : mode === "concise" ? 2 : 3;

    const qTokens = new Set(
      question.toLowerCase().split(/\W+/).filter((t) => t.length > 2)
    );

    // Score each hit's sentences by overlap with question.
    type Scored = { sentence: string; score: number; hitIndex: number };
    const scored: Scored[] = [];
    hits.forEach((h, i) => {
      const sentences = h.text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 10);
      const perHit: Scored[] = [];
      for (const s of sentences) {
        const sTokens = s.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
        const overlap = sTokens.filter((t) => qTokens.has(t)).length;
        if (overlap > 0) {
          perHit.push({ sentence: s.trim(), score: overlap / sTokens.length, hitIndex: i });
        }
      }
      perHit.sort((a, b) => b.score - a.score);
      scored.push(...perHit.slice(0, perHitSentences));
    });

    if (scored.length === 0) {
      // No keyword overlap → return first hit's first sentences verbatim.
      const first = hits[0];
      const sents = first.text.split(/(?<=[.!?])\s+/).slice(0, perHitSentences).join(" ");
      return { text: sents, groundedOnly: true, citationsUsed: [0] };
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, maxSentences);
    const dedup = Array.from(new Set(top.map((s) => s.sentence))).slice(0, maxSentences);

    return {
      text: dedup.join(" "),
      groundedOnly: true,
      citationsUsed: [...new Set(top.map((s) => s.hitIndex))].sort(),
    };
  }
}

// ---------------------------------------------------------------------------
// Gemini LLM (production)
// ---------------------------------------------------------------------------

const BASE_RULES = `Your job:
1. Answer the user's question using ONLY the provided context.
2. Cite every factual claim with [1], [2], ... matching the context number.
3. If the answer is not present in the context, say exactly:
   "I don't know based on the provided context."
4. Do not use external knowledge.
5. Never invent numbers, names, dates, or file paths.`;

/** Standard mode: today's behavior — short paragraphs + bullets. */
const SYSTEM_PROMPT = `You are a precise enterprise assistant.

${BASE_RULES}
6. Be concise. Prefer short paragraphs and bullets over prose.

Format:
- Lead with the direct answer in 1-2 sentences.
- Follow with supporting detail, each sentence ending with a citation like [1][2].
- If multiple sources support the same fact, cite them all.`;

/** Concise mode: as short as a correct, grounded answer can be. */
const CONCISE_SYSTEM_PROMPT = `You are a precise enterprise assistant.

${BASE_RULES}
6. Be as brief as possible while staying fully grounded and cited.

Format:
- One to three sentences, no headers, no bullet lists.
- Every sentence ends with a citation like [1][2].`;

/** Deep mode: a longer analytical brief that synthesizes across sources
 *  instead of just answering the literal question. */
const DEEP_SYSTEM_PROMPT = `You are a senior enterprise analyst producing a written brief.

${BASE_RULES}
6. Go beyond the literal question: surface patterns, agreements,
   contradictions, causes/effects, and implications that connect the
   provided sources — but every claim must still trace to the context
   and carry a citation. Do not pad with generic filler that isn't
   grounded in the context.

Format (use Markdown headers):
## Direct answer
1-3 sentences, cited.

## Analysis
Multiple short paragraphs or bullet groups, organized by theme, each
sentence carrying a citation like [1][2]. Compare/contrast sources where
they overlap or disagree.

## Key insights
3-6 bullets of synthesized takeaways — the "so what," not a restatement —
each still grounded in and cited to the context.

If the context is too thin to support real analysis, say so plainly instead
of inventing depth.`;

const SYSTEM_PROMPTS: Record<ResponseMode, string> = {
  concise: CONCISE_SYSTEM_PROMPT,
  standard: SYSTEM_PROMPT,
  deep: DEEP_SYSTEM_PROMPT,
};

/** Build the grounded user prompt shared by every provider. */
function buildUserPrompt(question: string, hits: RetrievalHit[]): string {
  const contextBlock = hits
    .map(
      (h, i) =>
        `[${i + 1}] (source: ${h.metadata.source}, chunk ${h.metadata.chunkIndex}, relevance ${h.score.toFixed(3)})\n${h.text}`
    )
    .join("\n\n");
  return `Context:\n${contextBlock}\n\nQuestion: ${question}\n\nAnswer with citations:`;
}

/** Extract the 0-based indices of citations the model actually used. */
function extractCitations(text: string, numHits: number): number[] {
  const cited = Array.from(text.matchAll(/\[(\d+)\]/g))
    .map((m) => parseInt(m[1], 10) - 1)
    .filter((i) => i >= 0 && i < numHits);
  return [...new Set(cited)].sort((a, b) => a - b);
}

export class GeminiLLM implements BaseLLM {
  readonly modelName: string;
  private readonly client: GoogleGenerativeAI;

  constructor(modelName?: string) {
    this.modelName = modelName ?? env.LLM_MODEL;
    this.client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }

  async generate(ctx: GenerationContext): Promise<GenerationResult> {
    const { question, hits, options } = ctx;

    if (hits.length === 0) {
      return { text: "I don't know based on the provided context.", groundedOnly: true, citationsUsed: [] };
    }

    const userPrompt = buildUserPrompt(question, hits);
    const mode = options?.responseMode ?? "standard";

    try {
      const model = this.client.getGenerativeModel({
        model: this.modelName,
        systemInstruction: SYSTEM_PROMPTS[mode],
        generationConfig: {
          temperature: options?.temperature ?? env.LLM_TEMPERATURE,
          maxOutputTokens: resolveMaxOutputTokens(options),
        },
      });

      const result = await model.generateContent(userPrompt);
      const text = result.response.text().trim();

      return {
        text,
        groundedOnly: true,
        citationsUsed: extractCitations(text, hits.length),
      };
    } catch (err) {
      logger.error("llm.generate_failed", {
        provider: "gemini",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Groq LLM (OpenAI-compatible, production-ready without Gemini)
// ---------------------------------------------------------------------------

export class GroqLLM implements BaseLLM {
  readonly modelName: string;
  private readonly client: OpenAI;

  constructor(modelName?: string) {
    this.modelName = modelName ?? env.GROQ_MODEL;
    this.client = new OpenAI({
      apiKey: env.GROQ_API_KEY,
      baseURL: env.GROQ_BASE_URL,
    });
  }

  async generate(ctx: GenerationContext): Promise<GenerationResult> {
    const { question, hits, options } = ctx;

    if (hits.length === 0) {
      return { text: "I don't know based on the provided context.", groundedOnly: true, citationsUsed: [] };
    }

    const userPrompt = buildUserPrompt(question, hits);
    const mode = options?.responseMode ?? "standard";

    try {
      const completion = await this.client.chat.completions.create({
        model: this.modelName,
        temperature: options?.temperature ?? env.LLM_TEMPERATURE,
        max_tokens: resolveMaxOutputTokens(options),
        messages: [
          { role: "system", content: SYSTEM_PROMPTS[mode] },
          { role: "user", content: userPrompt },
        ],
      });

      const text = (completion.choices[0]?.message?.content ?? "").trim();

      return {
        text,
        groundedOnly: true,
        citationsUsed: extractCitations(text, hits.length),
      };
    } catch (err) {
      logger.error("llm.generate_failed", {
        provider: "groq",
        model: this.modelName,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let cached: BaseLLM | null = null;

/**
 * Resolve the active LLM.
 *
 *   1. Groq, when GROQ_API_KEY is set. It gives real grounded generation
 *      even when Gemini/Upstash are absent, so it wins over the mock.
 *   2. Extractive MockLLM, in mock mode without a Groq key.
 *   3. Gemini, for a fully configured production deployment.
 */
export function getLLM(): BaseLLM {
  if (cached) return cached;
  if (hasGroq) {
    cached = new GroqLLM();
  } else if (isMockMode) {
    cached = new MockLLM();
  } else {
    cached = new GeminiLLM();
  }
  return cached;
}

export function resetLLM(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// Free-form completion (used by eval to synthesize questions from documents)
// ---------------------------------------------------------------------------

/**
 * One-shot text completion using the active real LLM (Groq or Gemini).
 * Returns null in mock mode or on error so callers can fall back gracefully.
 */
export async function generatePlainText(
  prompt: string,
  opts?: { maxTokens?: number; temperature?: number }
): Promise<string | null> {
  const maxTokens = opts?.maxTokens ?? 512;
  const temperature = opts?.temperature ?? 0.3;
  try {
    if (hasGroq) {
      const client = new OpenAI({ apiKey: env.GROQ_API_KEY, baseURL: env.GROQ_BASE_URL });
      const c = await client.chat.completions.create({
        model: env.GROQ_MODEL,
        temperature,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      });
      return (c.choices[0]?.message?.content ?? "").trim() || null;
    }
    if (hasGemini) {
      const client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
      const model = client.getGenerativeModel({
        model: env.LLM_MODEL,
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      });
      const r = await model.generateContent(prompt);
      return r.response.text().trim() || null;
    }
  } catch (err) {
    logger.warn("llm.generate_plain_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}