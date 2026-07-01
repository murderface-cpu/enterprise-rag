/**
 * Ingestion service.
 *
 * Single entry-point that takes uploaded documents, runs them through:
 *   loader → cleaner (already done in loader) → chunker → embedder → vector store
 *   + KB state update for incremental refresh / deletion.
 *
 * Errors are collected, not thrown, so a single bad file doesn't fail a
 * whole batch upload.
 */

import { getLoader } from "@/lib/ingestion/loaders";
import { getChunker } from "@/lib/chunking/strategies";
import { getEmbedder } from "@/lib/embeddings/embedder";
import { getVectorStore } from "@/lib/vectorstore/store";
import { getKBManager } from "@/lib/kb/manager";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { stableHash } from "@/lib/utils";
import type { DocumentRecord } from "@/lib/kb/manager";
import type { Chunk } from "@/lib/types";

export interface IngestionInput {
  filename: string;
  buffer: Buffer;
}

export interface IngestionResult {
  filename: string;
  status: "ingested" | "skipped_unchanged" | "failed";
  documentId?: string;
  chunksIngested: number;
  durationMs: number;
  reason?: string;
}

export interface IngestionSummary {
  total: number;
  ingested: number;
  skipped: number;
  failed: number;
  results: IngestionResult[];
  durationMs: number;
}

export async function ingestFiles(inputs: IngestionInput[]): Promise<IngestionSummary> {
  const t0 = performance.now();
  const embedder = getEmbedder();
  const vectorStore = getVectorStore();
  const kbManager = getKBManager();
  const chunker = getChunker("recursive", env.CHUNK_SIZE, env.CHUNK_OVERLAP);

  const results: IngestionResult[] = [];

  for (const input of inputs) {
    const t1 = performance.now();
    try {
      const loader = getLoader(input.filename);
      const docs = await loader.load(input.buffer, input.filename);

      if (docs.length === 0) {
        results.push({
          filename: input.filename,
          status: "failed",
          chunksIngested: 0,
          durationMs: performance.now() - t1,
          reason: "Document produced no extractable text",
        });
        continue;
      }

      const doc = docs[0]; // loaders return a single canonical doc per file
      const isNew = await kbManager.isNewOrUpdated(doc.metadata.source, doc.metadata.contentHash);

      if (!isNew) {
        results.push({
          filename: input.filename,
          status: "skipped_unchanged",
          chunksIngested: 0,
          durationMs: performance.now() - t1,
          reason: "Content unchanged since last ingestion",
        });
        continue;
      }

      // If a prior version of this source exists, remove its old vectors first.
      const prior = await kbManager.getDocumentBySource(doc.metadata.source);
      if (prior) {
        const oldChunkIds = await kbManager.listChunkIdsForDocument(prior.id);
        await vectorStore.delete(oldChunkIds).catch((err) => {
          logger.warn("ingestion.delete_old_vectors_failed", {
            source: doc.metadata.source,
            error: err instanceof Error ? err.message : String(err),
          });
        });
        await kbManager.deleteDocument(prior.id);
      }

      // Chunk → embed → upsert.
      const chunks: Chunk[] = chunker.chunk([doc]);
      const vectors = await embedder.embed(chunks.map((c) => c.text));

      await vectorStore.upsert(
        chunks.map((c, i) => ({
          id: c.id,
          vector: vectors[i],
          metadata: { ...c.metadata, text: c.text },
        }))
      );

      // Register in KB.
      const docRecord: DocumentRecord = {
        id: doc.id,
        source: doc.metadata.source,
        contentHash: doc.metadata.contentHash,
        uploadedAt: doc.metadata.uploadedAt,
        chunkCount: chunks.length,
        sizeBytes: doc.metadata.size ?? Buffer.byteLength(input.buffer),
        type: doc.metadata.type,
      };
      await kbManager.registerDocument(docRecord, chunks.map((c) => c.id));

      logger.info("ingestion.document_done", {
        source: doc.metadata.source,
        chunks: chunks.length,
        durationMs: Number((performance.now() - t1).toFixed(1)),
      });

      results.push({
        filename: input.filename,
        status: "ingested",
        documentId: doc.id,
        chunksIngested: chunks.length,
        durationMs: performance.now() - t1,
      });
    } catch (err) {
      logger.error("ingestion.document_failed", {
        filename: input.filename,
        error: err instanceof Error ? err.message : String(err),
      });
      results.push({
        filename: input.filename,
        status: "failed",
        chunksIngested: 0,
        durationMs: performance.now() - t1,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary: IngestionSummary = {
    total: inputs.length,
    ingested: results.filter((r) => r.status === "ingested").length,
    skipped: results.filter((r) => r.status === "skipped_unchanged").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
    durationMs: performance.now() - t0,
  };

  logger.info("ingestion.batch_complete", {
    ...summary,
    results: undefined, // Don't spam logs with full result list
  });

  return summary;
}

/**
 * Delete a document and all of its embedded chunks.
 */
export async function deleteDocument(documentId: string): Promise<{ removedChunks: number }> {
  const kbManager = getKBManager();
  const vectorStore = getVectorStore();

  const chunkIds = await kbManager.listChunkIdsForDocument(documentId);
  await vectorStore.delete(chunkIds);
  return kbManager.deleteDocument(documentId);
}

/** Generate a stable ingest-side id when caller doesn't supply one. */
export function makeIngestId(filename: string, contentHash: string): string {
  return `ing_${stableHash(`${filename}:${contentHash}`).slice(0, 16)}`;
}