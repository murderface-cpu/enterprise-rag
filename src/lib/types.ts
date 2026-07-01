/**
 * Core domain types used across ingestion, chunking, embedding,
 * retrieval, generation, and the API surface.
 */

/** A document loaded from any source. */
export interface RawDocument {
  id: string;
  text: string;
  metadata: DocumentMetadata;
}

/** Static metadata attached to every loaded document. */
export interface DocumentMetadata {
  source: string;
  type: "txt" | "md" | "pdf" | "docx" | "html";
  size?: number;
  pages?: number;
  uploadedAt: string;
  contentHash: string;
}

/** A chunk produced by the chunking layer. */
export interface Chunk {
  id: string;
  text: string;
  metadata: ChunkMetadata;
}

/** Per-chunk metadata, stable enough to round-trip through the vector store. */
export interface ChunkMetadata extends DocumentMetadata {
  parentDocId: string;
  chunkIndex: number;
  chunkSize: number;
  // 0-based position of the chunk start in the parent document's text.
  charStart: number;
  charEnd: number;
}

/** An embedded chunk: vector + payload for the vector DB. */
export interface EmbeddedChunk {
  id: string;
  vector: number[];
  metadata: ChunkMetadata;
}

/** A single retrieval hit. */
export interface RetrievalHit {
  id: string;
  score: number;
  text: string;
  metadata: ChunkMetadata;
}

/** A query for the RAG pipeline. */
export interface RAGQuery {
  question: string;
  topK?: number;
  filter?: Record<string, string | number | boolean>;
}

/** Observability payload returned by the RAG pipeline. */
export interface RAGResponse {
  answer: string;
  citations: Citation[];
  observability: {
    traceId: string;
    retrievalLatencyMs: number;
    generationLatencyMs: number;
    totalLatencyMs: number;
    numRetrieved: number;
    avgRelevance: number;
    confidence: "low" | "medium" | "high";
    model: string;
    groundedOnly: boolean;
  };
}

export interface Citation {
  index: number;
  source: string;
  page?: number;
  chunkIndex: number;
  score: number;
  snippet: string;
}

/** Document list entry returned by the KB API. */
export interface KBDocumentSummary {
  id: string;
  source: string;
  type: string;
  uploadedAt: string;
  contentHash: string;
  chunkCount: number;
  sizeBytes: number;
}

/** Stats for the /api/health & /api/metrics endpoints. */
export interface SystemMetrics {
  totalDocuments: number;
  totalChunks: number;
  vectorStoreSize: number;
  embeddingModel: string;
  llmModel: string;
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  uptimeSeconds: number;
  requestCounts: Record<string, number>;
  averageLatencyMs: Record<string, number>;
  isMockMode: boolean;
}