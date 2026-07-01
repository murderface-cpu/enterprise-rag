/**
 * POST /api/query
 *
 * Body: { question: string, topK?: number, filter?: {...} }
 *
 * Returns: RAGResponse with answer, citations, and observability.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withRoute, json, optionsHandler, parseBody } from "@/lib/api/helpers";
import { getRAGPipeline } from "@/lib/rag/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

export const OPTIONS = optionsHandler;

const querySchema = z.object({
  question: z.string().min(1, "question is required").max(4000),
  topK: z.number().int().positive().max(50).optional(),
  filter: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const handler = withRoute("query", async (req: NextRequest) => {
  const parsed = await parseBody(req, querySchema);
  if (!parsed.ok) return parsed.res;

  const pipeline = getRAGPipeline();
  const result = await pipeline.answer({
    question: parsed.data.question,
    topK: parsed.data.topK,
    filter: parsed.data.filter,
  });

  return json(result, { status: 200 });
});

export const POST = handler;