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
import { env, isMockMode, hasGroq } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { RetrievalHit } from "@/lib/types";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface LLMOptions {
  temperature?: number;
  maxOutputTokens?: number;
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
    const { question, hits } = ctx;
    if (hits.length === 0) {
      return { text: "I don't know based on the provided context.", groundedOnly: true, citationsUsed: [] };
    }

    const qTokens = new Set(
      question.toLowerCase().split(/\W+/).filter((t) => t.length > 2)
    );

    // Score each hit's sentences by overlap with question.
    type Scored = { sentence: string; score: number; hitIndex: number };
    const scored: Scored[] = [];
    hits.forEach((h, i) => {
      const sentences = h.text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 10);
      for (const s of sentences) {
        const sTokens = s.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
        const overlap = sTokens.filter((t) => qTokens.has(t)).length;
        if (overlap > 0) {
          scored.push({ sentence: s.trim(), score: overlap / sTokens.length, hitIndex: i });
        }
      }
    });

    if (scored.length === 0) {
      // No keyword overlap → return first hit's first 2 sentences verbatim.
      const first = hits[0];
      const sents = first.text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
      return { text: sents, groundedOnly: true, citationsUsed: [0] };
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 3);
    const dedup = Array.from(new Set(top.map((s) => s.sentence))).slice(0, 3);

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

const SYSTEM_PROMPT = `You are a precise enterprise assistant.

Your job:
1. Answer the user's question using ONLY the provided context.
2. Cite every factual claim with [1], [2], ... matching the context number.
3. If the answer is not present in the context, say exactly:
   "I don't know based on the provided context."
4. Do not use external knowledge.
5. Be concise. Prefer short paragraphs and bullets over prose.
6. Never invent numbers, names, dates, or file paths.

Format:
- Lead with the direct answer in 1-2 sentences.
- Follow with supporting detail, each sentence ending with a citation like [1][2].
- If multiple sources support the same fact, cite them all.`;

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

    try {
      const model = this.client.getGenerativeModel({
        model: this.modelName,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: {
          temperature: options?.temperature ?? env.LLM_TEMPERATURE,
          maxOutputTokens: options?.maxOutputTokens ?? env.LLM_MAX_OUTPUT_TOKENS,
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

    try {
      const completion = await this.client.chat.completions.create({
        model: this.modelName,
        temperature: options?.temperature ?? env.LLM_TEMPERATURE,
        max_tokens: options?.maxOutputTokens ?? env.LLM_MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
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