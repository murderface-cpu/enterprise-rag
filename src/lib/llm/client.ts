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
import { env, isMockMode } from "@/lib/env";
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
- Lead with the direct answer in 1–2 sentences.
- Follow with supporting detail, each sentence ending with a citation like [1][2].
- If multiple sources support the same fact, cite them all.`;

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

    const contextBlock = hits
      .map(
        (h, i) =>
          `[${i + 1}] (source: ${h.metadata.source}, chunk ${h.metadata.chunkIndex}, relevance ${h.score.toFixed(3)})\n${h.text}`
      )
      .join("\n\n");

    const userPrompt = `Context:\n${contextBlock}\n\nQuestion: ${question}\n\nAnswer with citations:`;

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

      // Detect citations actually used.
      const citedIndices = Array.from(text.matchAll(/\[(\d+)\]/g))
        .map((m) => parseInt(m[1], 10) - 1)
        .filter((i) => i >= 0 && i < hits.length);

      return {
        text,
        groundedOnly: true,
        citationsUsed: [...new Set(citedIndices)].sort((a, b) => a - b),
      };
    } catch (err) {
      logger.error("llm.generate_failed", {
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

export function getLLM(): BaseLLM {
  if (cached) return cached;
  cached = isMockMode ? new MockLLM() : new GeminiLLM();
  return cached;
}

export function resetLLM(): void {
  cached = null;
}