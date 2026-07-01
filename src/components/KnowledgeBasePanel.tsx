"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentRecord } from "@/lib/kb/manager";

export function KnowledgeBasePanel({ onChange }: { onChange?: () => void }) {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSummary, setUploadSummary] = useState<string | null>(null);
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
      // silent — sidebar still shows old state
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
      if (!files || (files instanceof FileList && files.length === 0)) return;
      setUploading(true);
      setUploadError(null);
      setUploadSummary(null);
      try {
        const form = new FormData();
        if (files instanceof FileList) {
          for (const f of Array.from(files)) form.append("files", f);
        } else {
          for (const f of files) form.append("files", f);
        }
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
        };
        setUploadSummary(
          `Ingested ${data.ingested}/${data.total} (skipped: ${data.skipped}, failed: ${data.failed})`
        );
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
      <div className="border-b border-ink-100 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink-900">Knowledge base</h2>
            <p className="text-xs text-ink-500">
              {loading ? "Loading…" : `${docs.length} document${docs.length === 1 ? "" : "s"}`}
            </p>
          </div>
          {docs.length > 0 && (
            <button
              onClick={reset}
              disabled={resetting}
              className="btn-danger !px-3 !py-1 text-xs"
            >
              {resetting ? "Clearing…" : "Clear all"}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin px-4 py-3 space-y-2">
        {uploadError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {uploadError}
          </div>
        )}
        {uploadSummary && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
            {uploadSummary}
          </div>
        )}

        <div
          onDragEnter={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (e.dataTransfer.files) upload(e.dataTransfer.files);
          }}
          className={`rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition ${
            dragActive
              ? "border-brand-500 bg-brand-50/40 text-brand-700"
              : "border-ink-200 text-ink-500"
          }`}
        >
          <p className="mb-1 font-medium">Drag & drop files here</p>
          <p className="mb-3 text-xs">.txt, .md, .pdf, .docx, .html — up to 10MB each</p>
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
            {uploading ? "Uploading…" : "Browse files"}
          </button>
        </div>

        {docs.length === 0 && !loading && (
          <p className="rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-500">
            No documents yet. Upload one to start building the knowledge base.
          </p>
        )}

        {docs.map((d) => (
          <div
            key={d.id}
            className="group flex items-start justify-between rounded-lg border border-ink-100 bg-white px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink-900" title={d.source}>
                {d.source}
              </p>
              <p className="text-xs text-ink-500">
                <span className="badge-gray mr-1 uppercase">{d.type}</span>
                {d.chunkCount} chunks · {(d.sizeBytes / 1024).toFixed(1)} KB ·{" "}
                {new Date(d.uploadedAt).toLocaleString()}
              </p>
            </div>
            <button
              onClick={() => remove(d.id)}
              className="ml-2 rounded p-1 text-ink-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
              title="Remove document"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}