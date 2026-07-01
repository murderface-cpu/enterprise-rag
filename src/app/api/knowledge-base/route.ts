/**
 * GET  /api/knowledge-base          → list all documents
 * DELETE /api/knowledge-base?id=... → remove a document + its chunks
 * POST /api/knowledge-base          → wipe everything (dangerous)
 */

import { NextRequest } from "next/server";
import { withRoute, json, optionsHandler } from "@/lib/api/helpers";
import { getKBManager } from "@/lib/kb/manager";
import { deleteDocument } from "@/lib/services/ingestion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const OPTIONS = optionsHandler;

export const GET = withRoute("knowledge-base.list", async (_req, ctx) => {
  const kb = getKBManager(ctx.sessionId);
  const docs = await kb.listDocuments();
  return json({ documents: docs, total: docs.length }, { status: 200 });
});

export const DELETE = withRoute<{ ok?: boolean; id?: string; removedChunks?: number; error?: string }>(
  "knowledge-base.delete",
  async (req: NextRequest, ctx) => {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return json({ error: "Missing ?id=<documentId> query parameter" }, { status: 400 });
    }

    const result = await deleteDocument(id, ctx.sessionId);
    if (result.removedChunks === 0) {
      return json({ error: "Document not found", id }, { status: 404 });
    }
    return json({ ok: true, id, ...result }, { status: 200 });
  }
);

// Clears ONLY the calling session's documents. We never call vectorStore.reset()
// here: the vector index is shared across sessions, so a global wipe would
// destroy other users' data.
export const POST = withRoute("knowledge-base.reset", async (_req, ctx) => {
  const kb = getKBManager(ctx.sessionId);
  const docs = await kb.listDocuments();
  let cleared = 0;
  for (const d of docs) {
    const r = await deleteDocument(d.id, ctx.sessionId);
    if (r.removedChunks > 0) cleared += 1;
  }
  return json({ ok: true, cleared }, { status: 200 });
});