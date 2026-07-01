/**
 * POST /api/embed
 *
 * Custom embeddings endpoint. Turns raw text into dense vectors using the
 * configured provider (in-process transformer by default, Gemini when a key
 * is present). Useful for debugging retrieval, powering external tools, or
 * embedding text without going through the full ingestion pipeline.
 *
 * Body (application/json):
 *   - input: string | string[]   the text(s) to embed
 *   - kind:  "query" | "passage" (default "passage"): queries get the
 *            retrieval instruction prefix for BGE-style models.
 *
 * Response:
 *   { model, dimension, count, embeddings: number[][] }
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withRoute, json, optionsHandler, parseBody } from "@/lib/api/helpers";
import { getEmbedder } from "@/lib/embeddings/embedder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export const OPTIONS = optionsHandler;

const embedSchema = z.object({
  input: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(64)]),
  kind: z.enum(["query", "passage"]).optional(),
});

export const POST = withRoute("embed", async (req: NextRequest) => {
  const parsed = await parseBody(req, embedSchema);
  if (!parsed.ok) return parsed.res;

  const { input, kind = "passage" } = parsed.data;
  const texts = Array.isArray(input) ? input : [input];
  const embedder = getEmbedder();

  const embeddings =
    kind === "query"
      ? await Promise.all(texts.map((t) => embedder.embedQuery(t)))
      : await embedder.embed(texts);

  return json(
    {
      model: embedder.modelName,
      dimension: embedder.dimension,
      count: embeddings.length,
      embeddings,
    },
    { status: 200 }
  );
});
