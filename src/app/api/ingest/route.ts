/**
 * POST /api/ingest
 *
 * Accepts multipart/form-data with one or more files, runs them through
 * the full ingestion pipeline (loader → chunker → embedder → vector store
 * + KB state), and returns a per-file status summary.
 *
 * Body:
 *   - files: one or more file parts (TXT/PDF/DOCX/HTML/MD, ≤ 10MB each)
 *   - strategy: "recursive" | "fixed" (default recursive)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRoute, json, optionsHandler, parseBody } from "@/lib/api/helpers";
import { ingestFiles } from "@/lib/services/ingestion";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
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

  const summary = await ingestFiles(inputs, ctx.sessionId);
  return json(summary, { status: 200 });
});

export const POST = handler;