/**
 * POST /api/ingest
 *
 * Accepts multipart/form-data with one or more files, runs them through
 * the full ingestion pipeline (loader → chunker → embedder → vector store
 * + KB state), and returns a per-file status summary.
 *
 * Body:
 *   - files: one or more file parts (TXT/PDF/DOCX/HTML/MD, ≤ MAX_FILE_SIZE_MB
 *     each, ≤ MAX_FILES_PER_UPLOAD per request — see lib/env.ts)
 *   - strategy: "recursive" | "fixed" (default recursive)
 *
 * Files in a batch are loaded/chunked/embedded/upserted concurrently (see
 * INGEST_CONCURRENCY), so multi-file uploads scale sub-linearly instead of
 * queueing one file behind the next.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRoute, json, optionsHandler, parseBody } from "@/lib/api/helpers";
import { ingestFiles } from "@/lib/services/ingestion";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
// Bounded by MAX_FILES_PER_UPLOAD; a large batch with several concurrency
// rounds needs more headroom than a single-file upload did.
export const maxDuration = 180;
export const runtime = "nodejs";

export const OPTIONS = optionsHandler;

const jsonIngestSchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().min(1),
        contentBase64: z.string().min(1),
      })
    )
    .min(1, "At least one file is required"),
  strategy: z.enum(["recursive", "fixed"]).optional(),
});

const handler = withRoute("ingest", async (req: NextRequest, ctx) => {
  const contentType = req.headers.get("content-type") ?? "";

  let inputs: { filename: string; buffer: Buffer }[] = [];

  if (contentType.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const files = form.getAll("files");
    for (const f of files) {
      if (!(f instanceof File)) continue;
      const buf = Buffer.from(await f.arrayBuffer());
      inputs.push({ filename: f.name || "upload.bin", buffer: buf });
    }
    if (inputs.length === 0) {
      return json({ error: "No files provided" }, { status: 400 });
    }
  } else if (contentType.includes("application/json")) {
    const parsed = await parseBody(req, jsonIngestSchema);
    if (!parsed.ok) return parsed.res;
    inputs = parsed.data.files.map((f) => ({
      filename: f.filename,
      buffer: Buffer.from(f.contentBase64, "base64"),
    }));
  } else {
    return json({ error: "Content-Type must be multipart/form-data or application/json" }, { status: 415 });
  }

  if (inputs.length > env.MAX_FILES_PER_UPLOAD) {
    return json(
      {
        error: `Too many files in one batch (${inputs.length}). Upload at most ${env.MAX_FILES_PER_UPLOAD} at a time.`,
      },
      { status: 400 }
    );
  }

  const summary = await ingestFiles(inputs, ctx.sessionId);
  return json(summary, { status: 200 });
});

export const POST = handler;