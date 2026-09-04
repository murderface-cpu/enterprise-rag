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
 *     "topK": 8,
 *     "numQueries": 6   // scale of the KB-derived eval set (ignored for custom/default corpora)
 *   }
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withRoute, json, optionsHandler, parseBody } from "@/lib/api/helpers";
import { getRAGPipeline } from "@/lib/rag/pipeline";
import { aggregate, citationPrecision, evaluateRetrieval } from "@/lib/evaluation/metrics";
import { DEFAULT_EVAL_CORPUS, buildCorpusFromKB, type EvalCase } from "@/lib/evaluation/corpus";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
// Scales with `numQueries` (each case runs an answer + a retrieval-only
// pass); give the largest configurable batch (25) real headroom.
export const maxDuration = 240;
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
  // How many documents to sample into a KB-derived eval set. Ignored when an
  // explicit `corpus` is supplied, or when the session KB is empty (the
  // built-in default corpus has a fixed size).
  numQueries: z.number().int().min(1).max(25).optional(),
});

export const POST = withRoute("evaluate", async (req: NextRequest, ctx) => {
  const parsed = await parseBody(req, evalBodySchema);
  if (!parsed.ok) return parsed.res;

  const topK = parsed.data.topK ?? env.TOP_K;

  // Corpus resolution:
  //   1. an explicit corpus in the request body, else
  //   2. one synthesized from THIS session's documents, else
  //   3. the built-in sample corpus (only when the session KB is empty).
  let corpus: EvalCase[];
  let corpusSource: "custom" | "kb" | "default";
  if (parsed.data.corpus) {
    corpus = parsed.data.corpus;
    corpusSource = "custom";
  } else {
    const built = await buildCorpusFromKB(ctx.sessionId, parsed.data.numQueries);
    if (built.source === "kb" && built.cases.length > 0) {
      corpus = built.cases;
      corpusSource = "kb";
    } else {
      corpus = DEFAULT_EVAL_CORPUS;
      corpusSource = "default";
    }
  }

  const pipeline = getRAGPipeline();
  // Every eval query is scoped to this session's documents.
  const filter = { sessionId: ctx.sessionId };

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
    const response = await pipeline.answer({ question: c.question, topK, filter });
    const retrievalOnly = await pipeline.retrieve({ question: c.question, topK, filter });

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
      corpusSource,
      topK,
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
});