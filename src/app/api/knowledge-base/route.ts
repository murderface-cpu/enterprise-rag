/**
 * GET  /api/knowledge-base          → list all documents
 * DELETE /api/knowledge-base?id=... → remove a document + its chunks
 * POST /api/knowledge-base          → wipe everything (dangerous)
 */

import { NextRequest } from "next/server";
import { withRoute, json, optionsHandler } from "@/lib/api/helpers";
import { getKBManager } from "@/lib/kb/manager";
import { getVectorStore } from "@/lib/vectorstore/store";
import { deleteDocument } from "@/lib/services/ingestion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const OPTIONS = optionsHandler;

export const GET = withRoute("knowledge-base.list", async () => {
  const kb = getKBManager();
  const docs = await kb.listDocuments();
  return json({ documents: docs, total: docs.length }, { status: 200 });
});

export const DELETE = withRoute<{ ok?: boolean; id?: string; removedChunks?: number; error?: string }>(
  "knowledge-base.delete",
  async (req: NextRequest) => {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return json({ error: "Missing ?id=<documentId> query parameter" }, { status: 400 });
    }

    const result = await deleteDocument(id);
    if (result.removedChunks === 0) {
      return json({ error: "Document not found", id }, { status: 404 });
    }
    return json({ ok: true, id, ...result }, { status: 200 });
  }
);

export const POST = withRoute("knowledge-base.reset", async () => {
  const kb = getKBManager();
  const vs = getVectorStore();
  const docs = await kb.listDocuments();
  for (const d of docs) {
    const r = await deleteDocument(d.id);
    if (r.removedChunks > 0) {
      // deleteDocument also clears vector store chunks; nothing extra needed.
    }
  }
  // Also wipe any orphans in the vector store that weren't tied to a doc.
  await vs.reset();
  return json({ ok: true, cleared: docs.length }, { status: 200 });
});