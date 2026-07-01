# Ingestion & knowledge-base lifecycle

The system supports **incremental ingestion**: each uploaded file is hashed
(SHA-256 over its normalized text) and only re-chunked / re-embedded when its
hash changes. The document registry lives in Redis, keyed by source filename.

## Steps when a file is uploaded

1. **Loader** picks a parser by extension (TXT / MD / PDF / DOCX / HTML) and
   produces a single normalized text document.
2. **Chunker** (recursive by default) splits the text into ~800-token chunks
   with ~120-token overlap, preferring paragraph > sentence > word boundaries.
3. **Embedder** (Gemini, batched 100 at a time) computes a 768-dim vector per
   chunk.
4. **Vector store** upserts the chunks. If a previous version of the file
   existed, its old chunk vectors are deleted first.
5. **KB manager** records the document's metadata + chunk-id list in Redis.

A second upload of the *same* file with unchanged content is a no-op: the
existing vectors are reused and zero Gemini calls are made. This is what makes
the system cheap to operate over time.

## Deletion

`DELETE /api/knowledge-base?id=<docId>` removes the document record from Redis
*and* deletes all of its chunk vectors from the vector store. Atomic per file.