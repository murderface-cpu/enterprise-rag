/**
 * Document ingestion: load + clean raw files into `RawDocument` objects.
 *
 * Architecture:
 *   - `BaseLoader` defines the contract.
 *   - Concrete loaders per format.
 *   - `getLoader(ext)` factory picks the right one by file extension or MIME.
 *   - `cleanText` normalizes whitespace, strips null bytes, fixes smart quotes.
 *   - Every loader produces the same shape so the chunking layer doesn't
 *     care what the source format was.
 */

import { stableHash } from "@/lib/utils";
import type { RawDocument, DocumentMetadata } from "@/lib/types";

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

export abstract class BaseLoader {
  abstract readonly supportedTypes: readonly string[];
  abstract load(input: Buffer | string, filename: string): Promise<RawDocument[]>;
}

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------

/**
 * Normalize raw extracted text. We do this in one place so every loader
 * benefits and downstream chunking sees consistent input.
 */
const SMART_QUOTE_MAP: Record<string, string> = {
  "\u2018": "'", // left single quote
  "\u2019": "'", // right single quote
  "\u201C": '"', // left double quote
  "\u201D": '"', // right double quote
};

export function cleanText(raw: string): string {
  return raw
    // Normalize unicode (smart quotes → straight, em-dash → -, ellipsis → ...)
    .replace(/[\u2018\u2019\u201C\u201D]/g, (c) => SMART_QUOTE_MAP[c] ?? c)
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2026/g, "...")
    // Strip null bytes and control chars (excluding \n, \r, \t)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    // Collapse runs of 3+ blank lines → 2
    .replace(/\n{3,}/g, "\n\n")
    // Trim trailing whitespace per line
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------------------
// TXT / Markdown
// ---------------------------------------------------------------------------

export class TextLoader extends BaseLoader {
  readonly supportedTypes = ["txt", "md", "markdown"] as const;

  async load(input: Buffer | string, filename: string): Promise<RawDocument[]> {
    const text = typeof input === "string" ? input : input.toString("utf-8");
    const cleaned = cleanText(text);
    if (!cleaned) return [];

    const ext = filename.toLowerCase().split(".").pop() ?? "txt";
    return [
      {
        id: `doc_${stableHash(filename + cleaned).slice(0, 16)}`,
        text: cleaned,
        metadata: makeMetadata(filename, ext, {
          size: cleaned.length,
          contentHash: stableHash(cleaned),
        }),
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export class PdfLoader extends BaseLoader {
  readonly supportedTypes = ["pdf"] as const;

  async load(input: Buffer | string, filename: string): Promise<RawDocument[]> {
    // Lazy import — pdf-parse pulls in test files that confuse bundlers.
    const { default: pdfParse } = await import("pdf-parse");
    const buffer = typeof input === "string" ? Buffer.from(input, "base64") : input;
    const parsed = await pdfParse(buffer, { max: 0 });

    const cleaned = cleanText(parsed.text || "");
    if (!cleaned) return [];

    return [
      {
        id: `doc_${stableHash(filename + cleaned).slice(0, 16)}`,
        text: cleaned,
        metadata: makeMetadata(filename, "pdf", {
          size: cleaned.length,
          pages: parsed.numpages,
          contentHash: stableHash(cleaned),
        }),
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

export class DocxLoader extends BaseLoader {
  readonly supportedTypes = ["docx"] as const;

  async load(input: Buffer | string, filename: string): Promise<RawDocument[]> {
    const mammoth = await import("mammoth");
    const buffer = typeof input === "string" ? Buffer.from(input, "base64") : input;
    const result = await mammoth.extractRawText({ buffer });
    const cleaned = cleanText(result.value || "");
    if (!cleaned) return [];

    return [
      {
        id: `doc_${stableHash(filename + cleaned).slice(0, 16)}`,
        text: cleaned,
        metadata: makeMetadata(filename, "docx", {
          size: cleaned.length,
          contentHash: stableHash(cleaned),
        }),
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

export class HtmlLoader extends BaseLoader {
  readonly supportedTypes = ["html", "htm"] as const;

  async load(input: Buffer | string, filename: string): Promise<RawDocument[]> {
    const raw = typeof input === "string" ? input : input.toString("utf-8");
    // Lightweight HTML → text: strip tags, decode common entities, normalize ws.
    const text = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/?(head|nav|footer|aside|form|button|svg|noscript)[\s\S]*?>/gi, " ")
      .replace(/<br\s*\/?>(?=\s|$)/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    const cleaned = cleanText(text);
    if (!cleaned) return [];

    return [
      {
        id: `doc_${stableHash(filename + cleaned).slice(0, 16)}`,
        text: cleaned,
        metadata: makeMetadata(filename, "html", {
          size: cleaned.length,
          contentHash: stableHash(cleaned),
        }),
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const REGISTRY: Record<string, BaseLoader> = {
  txt: new TextLoader(),
  md: new TextLoader(),
  markdown: new TextLoader(),
  pdf: new PdfLoader(),
  docx: new DocxLoader(),
  html: new HtmlLoader(),
  htm: new HtmlLoader(),
};

export function getLoader(filenameOrExt: string): BaseLoader {
  const ext = filenameOrExt.toLowerCase().replace(/^\./, "").split(".").pop() ?? "";
  const loader = REGISTRY[ext];
  if (!loader) {
    throw new Error(
      `Unsupported file type: "${ext}". Supported: ${Object.keys(REGISTRY).join(", ")}`
    );
  }
  return loader;
}

export function supportedExtensions(): string[] {
  return Object.keys(REGISTRY);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MetadataExtras {
  size?: number;
  pages?: number;
  contentHash: string;
}

function makeMetadata(
  filename: string,
  type: string,
  extra: MetadataExtras
): DocumentMetadata {
  return {
    source: filename,
    type: type as DocumentMetadata["type"],
    uploadedAt: new Date().toISOString(),
    size: extra.size,
    pages: extra.pages,
    contentHash: extra.contentHash,
  };
}