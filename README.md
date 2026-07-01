# Scalable Enterprise RAG

**Production-grade Retrieval-Augmented Generation system** designed to run end-to-end on
[Vercel](https://vercel.com) with zero infrastructure to manage.

Drop a handful of files into the UI, ask questions, get cited answers. Every
retrieval ships with latency, relevance scores, and a confidence label. The
evaluation panel generates a question set from your own uploaded documents and
reports Recall@K, MRR, nDCG@K, citation precision, and end-to-end p50/p95 latency.

This is a real system, not a demo. Modular RAG core, hybrid retrieval, real
embeddings, real vector DB, real rate limiting, real observability, and
per-session document isolation.

---

## ✨ Features

- **Multi-format ingestion**: TXT, Markdown, PDF, DOCX, HTML via a factory-based
  loader layer. Add a new format by registering one class.
- **Pluggable embeddings, no key required**: a real sentence-embedding model
  (`Xenova/bge-base-en-v1.5`, 768d) runs in-process via ONNX, so semantic search
  works with zero embedding API keys. Set `GEMINI_API_KEY` to use Gemini instead;
  the provider is selectable with `EMBEDDING_PROVIDER`.
- **Hybrid retrieval, two layers**: dense embeddings + in-process BM25 fused with
  reciprocal rank fusion. When the Upstash index is itself a hybrid (dense +
  sparse) index, the store also supplies a custom BM25-style sparse vector and
  lets Upstash fuse server-side. Both dense-only and hybrid indexes are
  auto-detected.
- **Grounded answers via Groq or Gemini**: every claim is cited `[1]`, `[2]`, …
  back to a source chunk. Groq (`openai/gpt-oss-20b`) powers generation when
  `GROQ_API_KEY` is set; Gemini is the alternative. The LLM is hard-prompted to
  refuse when the context doesn't support the answer.
- **Per-session document isolation**: each visitor gets an httpOnly session
  cookie. Uploads, retrieval, listing, and metrics are all scoped to that
  session, so one user never sees another's documents in the shared index.
- **Incremental KB lifecycle**: SHA-256 content hashing means re-uploading the
  same file is a no-op; re-uploading a *changed* file cleanly replaces old
  vectors.
- **Knowledge-base-adaptive evaluation**: click *Run evaluation* and the system
  synthesizes an eval set from *your* uploaded documents (LLM-generated
  questions with the source document as ground truth), then reports Recall@K,
  MRR, nDCG@K, citation precision, and p50/p95 latency.
- **Production-ready observability**: structured JSON logs in production,
  per-request trace IDs, in-process request counters + latency tracker,
  `/api/health` and `/api/metrics` endpoints ready for any monitoring stack.
- **Rate limiting**: Upstash Ratelimit in production, in-memory token bucket in
  dev. Fail-open on limiter outage so a quota blip never takes your service down.
- **Mock mode for zero-secret development**: no Upstash credentials? The app
  boots, accepts uploads, and answers questions with an in-memory store. Combine
  it with a Groq key for real answers, or run fully offline with deterministic stubs.
- **Serverless-native**: no long-running processes, no FAISS-on-disk. The
  embedding model is fetched once and cached to the serverless temp dir.

---

## 🏗️ Architecture

```
              ┌────────────┐
              │  Browser   │  (httpOnly `sid` session cookie)
              └─────┬──────┘
                    │  /api/query, /api/ingest, /api/embed, /api/evaluate
                    ▼
       ┌──────────────────────────────┐
       │   Next.js 14 (Vercel)        │
       │  ┌────────┐   ┌────────────┐ │
       │  │ Routes │ → │  RAG core  │ │
       │  └────────┘   └─────┬──────┘ │
       │   session scope     │        │
       │   rate limit        │        │
       │   metrics + logs    │        │
       └─────────┬───────────┘        │
                 │                     │
        ┌────────┼─────────┐          │
        ▼        ▼         ▼          │
   ┌─────────┐ ┌─────┐ ┌─────┐       │
   │ Local   │ │Ups. │ │Ups. │       │
   │ ONNX /  │ │Vec  │ │Redis│       │
   │ Gemini  │ │(hyb)│ │     │       │
   │ + Groq  │ │     │ │     │       │
   └─────────┘ └─────┘ └─────┘       │
                                       │
   per-request flow:                   │
   question → embed → dense/sparse ret │
   → BM25 re-rank → RRF fuse → top-K → │
   Groq grounded → citations + obs     │
```

| Layer            | Technology                                        | Why                                                                                  |
|------------------|---------------------------------------------------|--------------------------------------------------------------------------------------|
| App framework    | Next.js 14 (App Router, serverless)                | Vercel-native, scales to zero, no ops                                                |
| Embeddings       | In-process BGE-base (768d) or Gemini `text-embedding-004` | Real semantics with no key, or Gemini when configured                        |
| Vector store     | Upstash Vector (dense or hybrid)                   | Edge-friendly REST, pay-per-request, persistent; hybrid dense+sparse auto-detected   |
| KB state + cache | Upstash Redis                                      | Per-session document registry, chunk-id lists, embedding cache                       |
| Rate limiting    | Upstash Ratelimit                                  | Sliding-window quotas with fail-open                                                 |
| LLM              | Groq `openai/gpt-oss-20b` or Gemini 1.5 Flash      | Fast grounded generation with system-prompt adherence                                |
| Chunking         | Recursive (paragraph → sentence → word)            | Best retrieval quality on natural-language docs                                       |
| Retrieval        | Dense + sparse + BM25 fused with RRF               | Catches both paraphrased and exact-match queries                                      |

### Request flow (one query)

1. Browser → `POST /api/query { question, topK }` (session cookie attached automatically)
2. Rate-limit check (Upstash or in-memory); resolve session id
3. `getEmbedder().embedQuery()`: embed the question (local ONNX model or Gemini)
4. `UpstashVectorStore.search()`: top-K×4 candidates, filtered to the session's
   documents. On a hybrid index, a custom sparse vector is sent alongside the
   dense one and Upstash fuses them (RRF + IDF weighting).
5. `HybridRetriever`: BM25 over candidates, RRF-fuse with dense, return top-K
6. `getLLM().generate()`: grounded answer with `[1]`-style citations (Groq/Gemini)
7. Parse citations, build observability payload (latencies, relevance, confidence)
8. JSON response → browser

---

## 🚀 Quick start (local, no secrets)

```bash
npm install
npm run dev
```

Open http://localhost:3000. The app boots in **mock mode** with an in-memory
vector store, but embeddings are the **real** in-process BGE model, so semantic
search actually works. Add a `GROQ_API_KEY` (below) for real grounded answers,
or leave it out to use the extractive stub LLM.

> The first request downloads the embedding model (~90 MB) and caches it. Expect
> a slow first call, then fast ones.

## 🚀 Quick start (local, with real services)

```bash
cp .env.example .env.local
# fill in GROQ_API_KEY and the UPSTASH_* credentials (GEMINI_API_KEY is optional)

npm install
npm run dev
```

Open http://localhost:3000. The app switches to persistent mode automatically.

**Important: your Upstash Vector index dimension must match `EMBEDDING_DIM`.**
BGE-base is 768d. If your index is a different size (e.g. a 1536-dim hybrid
index), set `EMBEDDING_DIM` to match; the embedder zero-pads (lossless for
cosine) or truncates to fit.

## 🚀 Deploy to Vercel

1. Push to GitHub (the `murderface-cpu/enterprise-rag` repo or your fork).
2. Import the repo in Vercel; it auto-detects Next.js.
3. Add environment variables in **Project Settings → Environment Variables**:
   - `GROQ_API_KEY` (grounded answers), or `GEMINI_API_KEY`
   - `UPSTASH_VECTOR_REST_URL`, `UPSTASH_VECTOR_REST_TOKEN`
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
   - `ALLOW_MOCK_MODE=false`
   - `EMBEDDING_DIM` set to your Upstash index dimension
4. Click **Deploy**. The first build takes ~90 seconds; every subsequent push
   auto-deploys. The first request per cold instance downloads the embedding
   model to `/tmp` (~90 MB, ~35 s) and then runs warm.

To get credentials:

- Groq: <https://console.groq.com/keys>
- Upstash Vector: <https://console.upstash.com/vector> → **Create Index** (dense
  or hybrid), copy URL + token
- Upstash Redis: <https://console.upstash.com/redis> → **Create Database**, copy REST URL + token
- Gemini (optional): <https://aistudio.google.com/app/apikey>

---

## 📡 API reference

All routes are JSON over HTTPS. CORS is open (`*`). A first-party httpOnly `sid`
cookie scopes documents to the caller's session; browsers send it automatically.
All routes except `/api/health` rate-limit per source IP.

### `POST /api/ingest`

Upload one or more documents. Accepts both `multipart/form-data` and
`application/json`. Ingested documents are tagged with the caller's session.

`multipart/form-data`:
- `files`: one or more file parts (`.txt`, `.md`, `.pdf`, `.docx`, `.html`, `.htm`)

`application/json`:
```json
{ "files": [ { "filename": "report.pdf", "contentBase64": "..." } ] }
```

Response:
```json
{
  "total": 3,
  "ingested": 3,
  "skipped": 0,
  "failed": 0,
  "results": [
    { "filename": "report.pdf", "status": "ingested", "documentId": "doc_...", "chunksIngested": 12, "durationMs": 1834 }
  ],
  "durationMs": 2102
}
```

### `POST /api/query`

Retrieval is automatically restricted to the calling session's documents.

```json
{ "question": "What is RAG?", "topK": 8, "filter": { "source": "rag-overview.md" } }
```

Response:
```json
{
  "answer": "Retrieval-Augmented Generation (RAG) is an architecture that...",
  "citations": [
    { "index": 1, "source": "rag-overview.md", "chunkIndex": 0, "score": 0.91, "snippet": "..." }
  ],
  "observability": {
    "traceId": "tr_...",
    "retrievalLatencyMs": 23.4,
    "generationLatencyMs": 412.7,
    "totalLatencyMs": 442.1,
    "numRetrieved": 8,
    "avgRelevance": 0.78,
    "confidence": "high",
    "model": "openai/gpt-oss-20b",
    "groundedOnly": true
  }
}
```

### `POST /api/embed`

Custom embeddings endpoint. Turns text into dense vectors using the active
provider (in-process model by default, Gemini when configured).

```json
{ "input": ["first passage", "second passage"], "kind": "passage" }
```

`kind` is `"passage"` (default) or `"query"` (queries get the retrieval-instruction
prefix for BGE-style models). Response:
```json
{ "model": "Xenova/bge-base-en-v1.5", "dimension": 768, "count": 2, "embeddings": [[...], [...]] }
```

### `GET /api/knowledge-base`

Lists the **current session's** documents.
```json
{ "documents": [ { "id": "doc_...", "source": "...", "type": "pdf", "chunkCount": 12, "sizeBytes": 12345, ... } ], "total": 5 }
```

### `DELETE /api/knowledge-base?id=<docId>`

Removes one of the session's documents and its embedded chunks. 404 if the
document isn't found in this session (you cannot delete another session's docs).

### `POST /api/knowledge-base`

Clears **only the calling session's** documents (it never wipes the shared
index). Returns the count of cleared documents.

### `POST /api/evaluate`

Synthesizes an evaluation corpus from the session's uploaded documents and runs
it through the pipeline. Pass an explicit `corpus` to override; the built-in
sample corpus is used only when the session KB is empty. Body (optional):

```json
{ "corpus": [ { "question": "...", "relevantDocIds": ["..."], "expectedAnswerSubstrings": ["..."] } ], "topK": 8 }
```

Response includes `corpusSource` (`"kb"`, `"custom"`, or `"default"`):
```json
{
  "summary": {
    "numQueries": 6, "avgRecallAtK": 0.83, "avgMRR": 0.86, "avgNDCGAtK": 0.88,
    "avgLatencyMs": 612, "p50LatencyMs": 580, "p95LatencyMs": 920,
    "avgCitationPrecision": 0.79, "groundedOnlyFraction": 1.0
  },
  "perQuery": [ ... ],
  "corpusSource": "kb",
  "corpusSize": 6,
  "topK": 8
}
```

### `GET /api/health`

Liveness/readiness probe. 200 if both vector store and KB manager respond, 503
otherwise.

### `GET /api/metrics`

Counts reflect the caller's own session, not the shared index total.
```json
{
  "totalDocuments": 5,
  "totalChunks": 47,
  "vectorStoreSize": 47,
  "embeddingModel": "Xenova/bge-base-en-v1.5",
  "llmModel": "openai/gpt-oss-20b",
  "chunkSize": 800,
  "chunkOverlap": 120,
  "topK": 8,
  "uptimeSeconds": 1234,
  "requestCounts": { "query": 87, "ingest": 3, ... },
  "averageLatencyMs": { "query": 612.3, "ingest": 1820.1, ... },
  "isMockMode": false
}
```

---

## 🔬 Local scripts

```bash
npm run dev              # dev server with hot reload
npm run build            # production build
npm run start            # production server
npm run typecheck        # tsc --noEmit
npm run lint             # next lint
npm run seed             # upload docs/seed/*.md to a running server
npm run eval             # run evaluation against a running server
npm run test:api         # smoke-test health/metrics/knowledge-base/query
```

Override the target with `BASE_URL=https://my-rag.vercel.app npm run eval`.

---

## 🧩 Project structure

```
scalable-enterprise-rag/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── ingest/route.ts        # POST /api/ingest
│   │   │   ├── query/route.ts         # POST /api/query
│   │   │   ├── embed/route.ts         # POST /api/embed
│   │   │   ├── knowledge-base/route.ts # GET/DELETE/POST /api/knowledge-base
│   │   │   ├── evaluate/route.ts      # POST /api/evaluate
│   │   │   ├── health/route.ts        # GET /api/health
│   │   │   └── metrics/route.ts       # GET /api/metrics
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx                   # main UI
│   ├── components/
│   │   ├── ChatPanel.tsx              # Q&A interface
│   │   ├── CitationCard.tsx           # cited chunk card
│   │   ├── KnowledgeBasePanel.tsx     # upload + manage
│   │   ├── EvaluationPanel.tsx        # metrics dashboard
│   │   └── StatsBar.tsx               # live KB stats
│   ├── hooks/
│   │   └── useMetrics.ts              # polling hook
│   └── lib/
│       ├── env.ts                     # zod-validated env + provider resolution
│       ├── logger.ts                  # structured JSON logs
│       ├── types.ts                   # core domain types
│       ├── utils.ts                   # hashes, chunking helpers
│       ├── ingestion/loaders.ts       # TXT/MD/PDF/DOCX/HTML
│       ├── chunking/strategies.ts     # recursive + fixed chunkers
│       ├── embeddings/embedder.ts     # local ONNX + Gemini + mock
│       ├── embeddings/sparse.ts       # BM25-style sparse encoder (hybrid index)
│       ├── vectorstore/store.ts       # Upstash (dense/hybrid) + in-memory
│       ├── kb/manager.ts              # per-session KB state (Redis + in-memory)
│       ├── retrieval/retriever.ts     # dense + BM25 hybrid
│       ├── llm/client.ts              # Groq + Gemini + mock
│       ├── rag/pipeline.ts            # orchestrator
│       ├── services/ingestion.ts      # end-to-end, session-scoped ingest
│       ├── evaluation/metrics.ts      # recall, MRR, nDCG
│       ├── evaluation/corpus.ts       # KB-adaptive corpus builder + sample set
│       ├── observability/metrics.ts   # in-process counters
│       ├── security/ratelimit.ts      # Upstash + in-memory
│       └── api/helpers.ts             # route wrapper + session + JSON helpers
├── docs/seed/                         # sample markdown corpus
├── scripts/                           # smoke-test, seed, run-evaluation
├── .env.example
├── next.config.mjs
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── vercel.json
```

---

## ⚙️ Configuration reference

All env vars are validated by `src/lib/env.ts`. `GEMINI_API_KEY` is only required
when you force the Gemini embedding/LLM providers; everything else has a default.

| Var                        | Default                    | Description                                                                     |
|----------------------------|----------------------------|---------------------------------------------------------------------------------|
| `GROQ_API_KEY`             | optional                   | Enables Groq for grounded generation. <https://console.groq.com/keys>           |
| `GROQ_MODEL`               | `openai/gpt-oss-20b`       | Groq model id                                                                   |
| `GROQ_BASE_URL`            | `https://api.groq.com/openai/v1` | OpenAI-compatible Groq endpoint                                           |
| `GEMINI_API_KEY`           | optional                   | Enables Gemini embeddings/LLM. <https://aistudio.google.com/app/apikey>         |
| `UPSTASH_VECTOR_REST_URL`  | optional                   | Upstash Vector REST endpoint (dense or hybrid index)                            |
| `UPSTASH_VECTOR_REST_TOKEN`| optional                   | Upstash Vector REST token                                                       |
| `UPSTASH_REDIS_REST_URL`   | optional                   | Upstash Redis REST endpoint                                                     |
| `UPSTASH_REDIS_REST_TOKEN` | optional                   | Upstash Redis REST token                                                        |
| `EMBEDDING_PROVIDER`       | `auto`                     | `auto` \| `gemini` \| `local` \| `mock`. `auto` = Gemini if key, else local     |
| `LOCAL_EMBEDDING_MODEL`    | `Xenova/bge-base-en-v1.5`  | In-process ONNX embedding model (768d)                                          |
| `EMBEDDING_MODEL`          | `text-embedding-004`       | Gemini embedding model                                                          |
| `EMBEDDING_DIM`            | `768`                      | Vector dimension: must match your Upstash index                                 |
| `TRANSFORMERS_CACHE`       | temp dir                   | Where the local model is cached (serverless uses `/tmp`)                         |
| `CHUNK_SIZE`               | `800`                      | Approx. tokens per chunk                                                         |
| `CHUNK_OVERLAP`            | `120`                      | Approx. tokens of overlap between chunks                                         |
| `LLM_MODEL`                | `gemini-1.5-flash`         | Gemini model (used when Gemini generates)                                        |
| `LLM_TEMPERATURE`          | `0.2`                      | Lower = more deterministic answers                                              |
| `LLM_MAX_OUTPUT_TOKENS`    | `1024`                     | Cap on answer length                                                            |
| `TOP_K`                    | `8`                        | Chunks passed to the LLM                                                        |
| `MIN_RELEVANCE_SCORE`      | `0.5`                      | Drop chunks below this cosine similarity (dense-only indexes)                    |
| `RATE_LIMIT_PER_MINUTE`    | `60`                       | Per-IP request quota                                                            |
| `ALLOW_MOCK_MODE`          | `true`                     | When true, missing Upstash services fall back to in-memory stores               |
| `NODE_ENV`                 | `development`              | Set automatically by Vercel / `next start`                                      |

---

## 🛡️ Security notes

- **Secrets** never ship to the client. All calls go through Next.js API routes.
- **Per-session isolation.** Documents are scoped to an httpOnly `sid` cookie:
  retrieval, listing, deletion, reset, and metrics are all filtered to the
  caller's session. This is convenience isolation, not authentication; anyone
  who clears their cookie starts a fresh session. Add real auth
  (NextAuth/Clerk) to bind sessions to identities before public use.
- **CORS** is open for development. Tighten `corsHeaders()` in
  `src/lib/api/helpers.ts` before production use.
- **Rate limiting** is per-IP. Layer per-user limits on top if you add auth.
- **File uploads** are accepted up to Vercel's body size limit. Configure in
  `next.config.mjs` (`serverActions.bodySizeLimit`).

See [docs/SECURITY.md](./docs/SECURITY.md) for the full model.

---

## 🧠 Design philosophy

- **Serverless-first.** No long-running processes, no filesystem state (the
  embedding model caches to the ephemeral temp dir). State lives in Upstash.
- **No hard key requirement.** Real semantic search runs with zero embedding
  keys via the in-process model, and Groq gives real answers on a free tier.
- **Production observability, not vibes.** Every request gets a trace ID and
  times each pipeline stage. `/api/metrics` reports real, session-scoped numbers.
- **Modular RAG core.** `embedder`, `vectorStore`, `retriever`, `llm` all
  implement abstract interfaces. Swap providers by changing one factory.
- **Honest, self-adapting evaluation.** The eval set is generated from your own
  corpus so the numbers reflect what you actually uploaded.

---

## 🚧 Roadmap

- [ ] Cross-encoder reranking (e.g. `cross-encoder/ms-marco-MiniLM`)
- [ ] Streaming LLM responses (server-sent events)
- [ ] Real authentication binding sessions to user identities
- [ ] Anthropic Claude + OpenAI generation adapters
- [ ] Document Q&A history (per-session conversation persistence)
- [ ] Webhook callbacks for batch ingest jobs

---

## 📄 License

MIT: see [LICENSE](./LICENSE).
