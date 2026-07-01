/**
 * Chunking strategies.
 *
 *   - RecursiveChunker:  LangChain-style recursive splitter that prefers
 *                       paragraph > sentence > word boundaries.
 *   - FixedChunker:     Simple fixed-size with overlap (fallback).
 *
 * We default to recursive because it produces noticeably better retrieval
 * chunks on natural-language documents.
 */

import { stableHash } from "@/lib/utils";
import type { Chunk, ChunkMetadata, RawDocument } from "@/lib/types";

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

export abstract class BaseChunker {
  abstract chunk(docs: RawDocument[]): Chunk[];
}

// ---------------------------------------------------------------------------
// Recursive chunker
// ---------------------------------------------------------------------------

const DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " ", ""];

export interface RecursiveChunkerOptions {
  chunkSize: number;
  chunkOverlap: number;
  separators?: string[];
  /** Approximate characters-per-token. Gemini tokenization ≈ 4 chars. */
  charsPerToken?: number;
}

export class RecursiveChunker extends BaseChunker {
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;
  private readonly separators: string[];
  private readonly charsPerToken: number;

  constructor(opts: RecursiveChunkerOptions) {
    super();
    if (opts.chunkOverlap >= opts.chunkSize) {
      throw new Error("chunkOverlap must be smaller than chunkSize");
    }
    this.chunkSize = Math.max(1, Math.floor(opts.chunkSize));
    this.chunkOverlap = Math.max(0, Math.floor(opts.chunkOverlap));
    this.separators = opts.separators ?? DEFAULT_SEPARATORS;
    this.charsPerToken = opts.charsPerToken ?? 4;
  }

  chunk(docs: RawDocument[]): Chunk[] {
    const out: Chunk[] = [];
    for (const doc of docs) {
      const sizeChars = Math.floor(this.chunkSize * this.charsPerToken);
      const overlapChars = Math.floor(this.chunkOverlap * this.charsPerToken);

      const pieces = this._splitText(doc.text, this.separators, sizeChars);

      // Re-join pieces into chunks of ~chunkSize with overlap.
      const merged = this._mergeWithOverlap(pieces, sizeChars, overlapChars);

      let charCursor = 0;
      merged.forEach((text, idx) => {
        if (!text.trim()) return;

        const start = doc.text.indexOf(text, charCursor);
        const safeStart = start >= 0 ? start : charCursor;
        const end = safeStart + text.length;
        charCursor = safeStart + Math.max(0, text.length - overlapChars);

        const meta: ChunkMetadata = {
          ...doc.metadata,
          parentDocId: doc.id,
          chunkIndex: idx,
          chunkSize: text.length,
          charStart: safeStart,
          charEnd: end,
        };

        out.push({
          id: `chunk_${stableHash(`${doc.id}:${idx}:${text}`).slice(0, 16)}`,
          text,
          metadata: meta,
        });
      });
    }
    return out;
  }

  /**
   * Recursively split `text` along the given separators until each piece
   * is smaller than `chunkSizeChars`.
   */
  private _splitText(text: string, separators: string[], chunkSizeChars: number): string[] {
    if (text.length <= chunkSizeChars) return [text];

    const sep = separators[0];
    const next = separators.slice(1);

    if (!sep) {
      // Final fallback: hard cut.
      const out: string[] = [];
      for (let i = 0; i < text.length; i += chunkSizeChars) {
        out.push(text.slice(i, i + chunkSizeChars));
      }
      return out;
    }

    const splits = text.split(sep);
    const pieces: string[] = [];
    for (let i = 0; i < splits.length; i++) {
      const piece = splits[i] + (i < splits.length - 1 ? sep : "");
      if (piece.length <= chunkSizeChars) {
        pieces.push(piece);
      } else {
        pieces.push(...this._splitText(piece, next, chunkSizeChars));
      }
    }
    return pieces;
  }

  /**
   * Greedy merge: combine consecutive small pieces until the running
   * chunk approaches the size limit, then start a new chunk with `overlap`
   * characters of the previous chunk as context.
   */
  private _mergeWithOverlap(pieces: string[], sizeChars: number, overlapChars: number): string[] {
    const chunks: string[] = [];
    let buffer = "";

    for (const piece of pieces) {
      const candidate = buffer.length === 0 ? piece : buffer + piece;

      if (candidate.length <= sizeChars) {
        buffer = candidate;
        continue;
      }

      // Buffer is full — flush it.
      if (buffer.length > 0) {
        chunks.push(buffer);
        // Take the tail of the previous chunk as overlap seed.
        buffer = buffer.slice(Math.max(0, buffer.length - overlapChars)) + piece;
      } else {
        // Single piece larger than chunk size — push as-is.
        chunks.push(piece);
        buffer = "";
      }
    }

    if (buffer.length > 0) chunks.push(buffer);
    return chunks;
  }
}

// ---------------------------------------------------------------------------
// Fixed chunker (simple fallback)
// ---------------------------------------------------------------------------

export interface FixedChunkerOptions {
  chunkSize: number;
  chunkOverlap: number;
  charsPerToken?: number;
}

export class FixedChunker extends BaseChunker {
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;
  private readonly charsPerToken: number;

  constructor(opts: FixedChunkerOptions) {
    super();
    if (opts.chunkOverlap >= opts.chunkSize) {
      throw new Error("chunkOverlap must be smaller than chunkSize");
    }
    this.chunkSize = Math.max(1, Math.floor(opts.chunkSize));
    this.chunkOverlap = Math.max(0, Math.floor(opts.chunkOverlap));
    this.charsPerToken = opts.charsPerToken ?? 4;
  }

  chunk(docs: RawDocument[]): Chunk[] {
    const out: Chunk[] = [];
    const stride = Math.floor(this.chunkSize * this.charsPerToken);
    const overlap = Math.floor(this.chunkOverlap * this.charsPerToken);

    for (const doc of docs) {
      let i = 0;
      let chunkIndex = 0;
      while (i < doc.text.length) {
        const text = doc.text.slice(i, i + stride);
        if (text.trim()) {
          const meta: ChunkMetadata = {
            ...doc.metadata,
            parentDocId: doc.id,
            chunkIndex,
            chunkSize: text.length,
            charStart: i,
            charEnd: i + text.length,
          };
          out.push({
            id: `chunk_${stableHash(`${doc.id}:${chunkIndex}:${text}`).slice(0, 16)}`,
            text,
            metadata: meta,
          });
          chunkIndex += 1;
        }
        i += Math.max(1, stride - overlap);
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function getChunker(strategy: "recursive" | "fixed", chunkSize: number, chunkOverlap: number): BaseChunker {
  if (strategy === "fixed") {
    return new FixedChunker({ chunkSize, chunkOverlap });
  }
  return new RecursiveChunker({ chunkSize, chunkOverlap });
}