/**
 * POST /api/evaluate
 *
 * Runs the built-in (or user-supplied) evaluation corpus through the
 * pipeline and returns aggregated retrieval + generation metrics.
 *
 * Body (optional):
 *   {
 *     "corpus": [
 *       { "question": "...", "relevantDocIds": ["..."], "expectedAnswerSubstrings": ["..."] },
 *       ...
 *     ],
 *     "topK": 8
 *   }
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withRoute, json, optionsHandler, parseBody } from "@/lib/api/helpers";
import { getRAGPipeline } from "@/lib/rag/pipeline";
import { aggregate, citationPrecision, evaluateRetrieval } from "@/lib/evaluation/metrics";
import { DEFAULT_EVAL_CORPUS } from "@/lib/evaluation/corpus";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const runtime = "nodejs";

export const OPTIONS = optionsHandler;

const evalBodySchema = z.object({
  corpus: z
    .array(
      z.object({
        question: z.string().min(1),
        relevantDocIds: z.array(z.string()).optional(),
        relevantChunkIds: z.array(z.string()).optional(),
        expectedAnswerSubstrings: z.array(z.string()).optional(),
      })
    )
    .optional(),
  topK: z.number().int().positive().max(50).optional(),
});

export const POST = withRoute("evaluate", async (req: NextRequest) => {
  const parsed = await parseBody(req, evalBodySchema);
  if (!parsed.ok) return parsed.res;

  const corpus = parsed.data.corpus ?? DEFAULT_EVAL_CORPUS;
  const topK = parsed.data.topK ?? env.TOP_K;

  const pipeline = getRAGPipeline();

  const rows: {
    question: string;
    retrieval: ReturnType<typeof evaluateRetrieval>;
    latencyMs: number;
    citationPrecision: number;
    grounded: boolean;
    answer: string;
  }[] = [];

  for (const c of corpus) {
    const t0 = performance.now();
    const response = await pipeline.answer({ question: c.question, topK });
    const retrievalOnly = await pipeline.retrieve({ question: c.question, topK });

    rows.push({
      question: c.question,
      retrieval: evaluateRetrieval(retrievalOnly, c, topK),
      latencyMs: performance.now() - t0,
      citationPrecision: citationPrecision(
        response.citations.map((ci) => ({ text: retrievalOnly[ci.index - 1]?.text ?? "" })),
        c.expectedAnswerSubstrings ?? []
      ),
      grounded: response.observability.groundedOnly,
      answer: response.answer,
    });
  }

  const summary = aggregate(rows);

  return json(
    {
      summary,
      perQuery: rows,
      corpusSize: corpus.length,
      topK,
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
});