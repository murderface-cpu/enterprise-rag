"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentRecord } from "@/lib/kb/manager";

const FILE_ICONS: Record<string, string> = {
  pdf: "📄",
  docx: "📝",
  txt: "📃",
  md: "📋",
  html: "🌐",
};

// Mirrors src/lib/env.ts MAX_FILE_SIZE_MB / MAX_FILES_PER_UPLOAD defaults —
// just for a fast client-side check before we bother the network; the
// server enforces the real (possibly operator-overridden) limits.
const MAX_FILE_SIZE_MB = 10;
const MAX_FILES_PER_UPLOAD = 25;

export function KnowledgeBasePanel({ onChange }: { onChange?: () => void }) {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSummary, setUploadSummary] = useState<string | null>(null);
  const [uploadCount, setUploadCount] = useState(0);
  const [resetting, setResetting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge-base", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { documents: DocumentRecord[] };
      setDocs(data.documents);
    } catch (e) {
      // silent: sidebar still shows old state
      console.warn("Failed to refresh KB", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [refresh]);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files ?? []);
      if (list.length === 0) return;

      if (list.length > MAX_FILES_PER_UPLOAD) {
        setUploadError(`Too many files at once (${list.length}). Upload at most ${MAX_FILES_PER_UPLOAD} per batch.`);
        return;
      }
      const oversized = list.filter((f) => f.size > MAX_FILE_SIZE_MB * 1024 * 1024);
      if (oversized.length > 0) {
        setUploadError(
          `${oversized.length} file${oversized.length === 1 ? "" : "s"} exceed${oversized.length === 1 ? "s" : ""} ${MAX_FILE_SIZE_MB}MB: ${oversized.map((f) => f.name).join(", ")}`
        );
        return;
      }

      setUploading(true);
      setUploadCount(list.length);
      setUploadError(null);
      setUploadSummary(null);
      try {
        const form = new FormData();
        for (const f of list) form.append("files", f);
        const res = await fetch("/api/ingest", { method: "POST", body: form });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`HTTP ${res.status}: ${t}`);
        }
        const data = (await res.json()) as {
          ingested: number;
          skipped: number;
          failed: number;
          total: number;
          results: { filename: string; status: string; reason?: string }[];
        };
        setUploadSummary(
          `Ingested ${data.ingested}/${data.total} (skipped: ${data.skipped}, failed: ${data.failed})`
        );
        if (data.failed > 0) {
          const reasons = data.results
            .filter((r) => r.status === "failed")
            .map((r) => `${r.filename}: ${r.reason ?? "unknown error"}`)
            .join("\n");
          setUploadError(reasons);
        }
        await refresh();
        onChange?.();
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [refresh, onChange]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!confirm("Remove this document and all its chunks from the knowledge base?")) return;
      try {
        const res = await fetch(`/api/knowledge-base?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`HTTP ${res.status}: ${t}`);
        }
        await refresh();
        onChange?.();
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [refresh, onChange]
  );

  const reset = useCallback(async () => {
    if (
      !confirm(
        "This will delete ALL documents and ALL embeddings. Are you sure?"
      )
    )
      return;
    setResetting(true);
    try {
      const res = await fetch("/api/knowledge-base", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
      onChange?.();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  }, [refresh, onChange]);

  return (
    <div className="card flex h-[calc(100vh-220px)] flex-col">
      {/* Header */}
      <div className="border-b border-ink-100 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink-900">Knowledge Base</h2>
            <p className="text-xs text-ink-500">
              {loading ? (
                <span className="skeleton inline-block h-3 w-20 rounded align-middle" />
              ) : (
                `${docs.length} document${docs.length === 1 ? "" : "s"}`
              )}
            </p>
          </div>
          {docs.length > 0 && (
            <button
              onClick={reset}
              disabled={resetting}
              className="btn-danger !px-3 !py-1 text-xs"
            >
              {resetting ? "Clearing..." : "Clear all"}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin px-4 py-3 space-y-2">
        {/* Feedback banners */}
        {uploadError && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <svg className="mt-0.5 shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="whitespace-pre-wrap">{uploadError}</span>
          </div>
        )}
        {uploadSummary && (
          <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
            <svg className="mt-0.5 shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {uploadSummary}
          </div>
        )}

        {/* Drop zone */}
        <div
          onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (e.dataTransfer.files) upload(e.dataTransfer.files);
          }}
          className={`rounded-xl border-2 border-dashed px-4 py-5 text-center transition-all ${
            dragActive
              ? "border-brand-500 bg-brand-50/60 text-brand-700 scale-[1.01]"
              : "border-ink-200 text-ink-500 hover:border-ink-300 hover:bg-ink-50/50"
          }`}
        >
          <div className="mb-2 flex justify-center">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke={dragActive ? "currentColor" : "#9ca3af"}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="16 16 12 12 8 16" />
              <line x1="12" y1="12" x2="12" y2="21" />
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
            </svg>
          </div>
          <p className="mb-0.5 text-sm font-medium">
            {dragActive ? "Drop to upload" : "Drag files here"}
          </p>
          <p className="mb-3 text-xs text-ink-400">
            .txt, .md, .pdf, .docx, .html &middot; up to {MAX_FILE_SIZE_MB}MB each &middot; up to {MAX_FILES_PER_UPLOAD} files per batch
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,.markdown,.pdf,.docx,.html,.htm"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) upload(e.target.files);
            }}
          />
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <span className="flex items-center gap-1.5">
                <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Uploading {uploadCount} file{uploadCount === 1 ? "" : "s"}...
              </span>
            ) : (
              "Browse files"
            )}
          </button>
        </div>

        {/* Empty state */}
        {docs.length === 0 && !loading && (
          <div className="rounded-lg border border-dashed border-ink-200 bg-ink-50/30 px-4 py-5 text-center">
            <p className="text-xs text-ink-500">No documents yet. Upload one above to start building your knowledge base.</p>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && docs.length === 0 && (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="rounded-lg border border-ink-100 bg-white px-3 py-2">
                <div className="skeleton mb-1 h-3.5 w-3/4 rounded" />
                <div className="skeleton h-3 w-1/2 rounded" />
              </div>
            ))}
          </div>
        )}

        {/* Document list */}
        {docs.map((d) => (
          <div
            key={d.id}
            className="group flex items-start justify-between rounded-lg border border-ink-100 bg-white px-3 py-2.5 transition-shadow hover:shadow-sm"
          >
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <span className="mt-0.5 shrink-0 text-base leading-none" role="img" aria-label={d.type}>
                {FILE_ICONS[d.type] ?? "📎"}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink-900" title={d.source}>
                  {d.source}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  <span className="badge-gray mr-1 uppercase">{d.type}</span>
                  {d.chunkCount} chunks &middot; {(d.sizeBytes / 1024).toFixed(1)} KB &middot;{" "}
                  {new Date(d.uploadedAt).toLocaleString()}
                </p>
              </div>
            </div>
            <button
              onClick={() => remove(d.id)}
              className="ml-2 shrink-0 rounded p-1 text-ink-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
              title="Remove document"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
