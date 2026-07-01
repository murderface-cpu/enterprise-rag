# Scalable Enterprise RAG

**Production-grade Retrieval-Augmented Generation system** designed to run end-to-end on
[Vercel](https://vercel.com) with zero infrastructure to manage.

Drop a handful of files into the UI, ask questions, get cited answers. Every
retrieval ships with latency, relevance scores, and a confidence label. A
built-in evaluation corpus reports Recall@K, MRR, nDCG@K, citation precision,
and end-to-end p50/p95 latency on every run.

This is a real system, not a demo. Modular RAG core, hybrid retrieval, real
embeddings, real vector DB, real rate limiting, real observability.

---

## ✨ Features

- **Multi-format ingestion** — TXT, Markdown, PDF, DOCX, HTML via a factory-based
  loader layer. Add a new format by registering one class.
- **Hybrid retrieval** — dense Gemini embeddings + lightweight in-process BM25,
  fused with reciprocal rank fusion. Outperforms pure-dense on enterprise
  corpora that mix prose with precise technical terms.
- **Grounded answers** — every claim is cited `[1]`, `[2]`, … back to a source
  chunk. The LLM is hard-prompted to refuse when context doesn't support the answer.
- **Incremental KB lifecycle** — SHA-256 content hashing means re-uploading the
  same file is a no-op; re-uploading a *changed* file cleanly replaces old
  vectors.
- **Production-ready observability** — structured JSON logs in production,
  per-request trace IDs, in-process request counters + latency tracker,
  `/api/health` and `/api/metrics` endpoints ready for any monitoring stack.
- **Built-in evaluation** — ships with a sample corpus; click *Run evaluation*
  in the UI to populate Recall@K, MRR, nDCG@K, citation precision, p50/p95
  latency. Replace with your own domain corpus to measure real quality.
- **Rate limiting** — Upstash Ratelimit in production, in-memory token bucket in
  dev. Fail-open on limiter outage so a quota blip never takes your service down.
- **Mock mode for zero-secret development** — no Gemini or Upstash credentials?
  The app boots, accepts uploads, and answers questions with deterministic stubs.
  Great for previews, CI, and local hacking.
- **Serverless-native** — no long-running processes, no FAISS-on-disk, no native
  dependencies. Just pure HTTP and the Node 18+ runtime Vercel gives you.

---

## 🏗️ Architecture

```
              ┌────────────┐
              │  Browser   │
              └─────┬──────┘
                    │  /api/query, /api/ingest, /api/evaluate
                    ▼
       ┌──────────────────────────────┐
       │   Next.js 14 (Vercel Edge)   │
       │  ┌────────┐   ┌────────────┐ │
       │  │ Routes │ → │  RAG core  │ │
       │  └────────┘   └─────┬──────┘ │
       │                     │        │
       │   rate limit        │        │
       │   metrics           │        │
       │   structured logs   │        │
       └─────────┬───────────┘        │
                 │                    │
        ┌────────┼────────┐           │
        ▼        ▼        ▼           │
   ┌────────┐ ┌─────┐ ┌─────┐        │
   │ Gemini │ │Ups. │ │Ups. │        │
   │ Embed  │ │Vec  │ │Redis│        │
   │ + LLM  │ │     │ │     │        │
   └────────┘ └─────┘ └─────┘        │
                                       │
   per-request flow:                   │
   question → embed → dense ret →     │
   BM25 re-rank → RRF fuse → top-K →  │
   Gemini grounded → citations + obs  │
```

| Layer            | Technology                                      | Why                                                                                  |
|------------------|-------------------------------------------------|--------------------------------------------------------------------------------------|
| App framework    | Next.js 14 (App Router, serverless)              | Vercel-native, scales to zero, no ops                                                |
| Embeddings       | Google Gemini `text-embedding-004` (768d)        | Strong quality, low cost, single API key                                             |
| Vector store     | Upstash Vector                                    | Edge-friendly REST, pay-per-request, persistent                                      |
| KB state + cache | Upstash Redis                                     | Document registry, chunk-id lists, embedding cache                                   |
| Rate limiting    | Upstash Ratelimit                                 | Sliding-window quotas with fail-open                                                 |
| LLM              | Google Gemini 1.5 Flash                           | Fast grounded generation with system-prompt adherence                                |
| Chunking         | Recursive (paragraph → sentence → word)          | Best retrieval quality on natural-language docs                                       |
| Retrieval        | Dense + BM25 fused with RRF                       | Catches both paraphrased and exact-match queries                                      |

### Request flow (one query)

1. Browser → `POST /api/query { question, topK }`
2. Rate-limit check (Upstash or in-memory)
3. `GeminiEmbedder.embedQuery()` — embed the question
4. `UpstashVectorStore.search()` — top-K×4 candidates by cosine similarity
5. `HybridRetriever` — BM25 over candidates, RRF-fuse with dense, return top-K
6. `GeminiLLM.generate()` — grounded answer with `[1]`-style citations
7. Parse citations from the LLM output, build observability payload (latencies,
   relevance, confidence)
8. JSON response → browser

---

## 🚀 Quick start (local, no secrets)

```bash
npm install
npm run dev
```

Open http://localhost:3000. The app boots in **mock mode** — uploads work,
questions work, but the embeddings are deterministic hashes and the LLM does
extractive summarization. Useful for UI iteration.

## 🚀 Quick start (local, with real services)

```bash
cp .env.example .env.local
# fill in GEMINI_API_KEY, UPSTASH_* credentials

npm install
npm run dev
```

Open http://localhost:3000. The app switches to production mode automatically.

## 🚀 Deploy to Vercel

1. Push to GitHub (the `murderface-cpu/enterprise-rag` repo or your fork).
2. Import the repo in Vercel — it auto-detects Next.js.
3. Add environment variables in **Project Settings → Environment Variables**:
   - `GEMINI_API_KEY`
   - `UPSTASH_VECTOR_REST_URL`
   - `UPSTASH_VECTOR_REST_TOKEN`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
4. Click **Deploy**. The first build takes ~90 seconds. Every subsequent push
   auto-deploys.

To get Upstash credentials:

- Vector: <https://console.upstash.com/vector> → **Create Index**, copy URL + token
- Redis: <https://console.upstash.com/redis> → **Create Database**, copy REST URL + token

To get a Gemini key: <https://aistudio.google.com/app/apikey>.

---

## 📡 API reference

All routes are JSON over HTTPS. CORS is open (`*`). All routes except
`/api/health`, `/api/metrics` rate-limit per source IP.

### `POST /api/ingest`

Upload one or more documents. Accepts both `multipart/form-data` and
`application/json`.

`multipart/form-data`:
- `files`: one or more file parts (`.txt`, `.md`, `.pdf`, `.docx`, `.html`, `.htm`)

`application/json`:
```json
{
  "files": [
    { "filename": "report.pdf", "contentBase64": "..." }
  ]
}
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
    "model": "gemini-1.5-flash",
    "groundedOnly": true
  }
}
```

### `GET /api/knowledge-base`

```json
{ "documents": [ { "id": "doc_...", "source": "...", "type": "pdf", "chunkCount": 12, "sizeBytes": 12345, ... } ], "total": 5 }
```

### `DELETE /api/knowledge-base?id=<docId>`

Removes a document and all its embedded chunks. 404 if not found.

### `POST /api/knowledge-base`

**Dangerous.** Wipes the entire knowledge base. Returns the count of cleared
documents.

### `POST /api/evaluate`

Runs the built-in (or supplied) evaluation corpus through the pipeline and
reports aggregated metrics. Body (optional):

```json
{
  "corpus": [
    { "question": "...", "relevantDocIds": ["..."], "expectedAnswerSubstrings": ["..."] }
  ],
  "topK": 8
}
```

Response:
```json
{
  "summary": {
    "numQueries": 5,
    "avgRecallAtK": 0.80,
    "avgMRR": 0.83,
    "avgNDCGAtK": 0.85,
    "avgLatencyMs": 612,
    "p50LatencyMs": 580,
    "p95LatencyMs": 920,
    "avgCitationPrecision": 0.74,
    "groundedOnlyFraction": 1.0
  },
  "perQuery": [ ... ]
}
```

### `GET /api/health`

Liveness/readiness probe. 200 if both vector store and KB manager respond, 503
otherwise. Designed for use with Vercel's built-in monitoring or external
uptime services.

### `GET /api/metrics`

```json
{
  "totalDocuments": 5,
  "totalChunks": 47,
  "vectorStoreSize": 47,
  "embeddingModel": "text-embedding-004",
  "llmModel": "gemini-1.5-flash",
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
│       ├── env.ts                     # zod-validated env
│       ├── logger.ts                  # structured JSON logs
│       ├── types.ts                   # core domain types
│       ├── utils.ts                   # hashes, chunking helpers
│       ├── ingestion/loaders.ts       # TXT/MD/PDF/DOCX/HTML
│       ├── chunking/strategies.ts     # recursive + fixed chunkers
│       ├── embeddings/embedder.ts     # Gemini + mock
│       ├── vectorstore/store.ts       # Upstash + in-memory
│       ├── kb/manager.ts              # KB state (Redis + in-memory)
│       ├── retrieval/retriever.ts     # dense + BM25 hybrid
│       ├── llm/client.ts              # Gemini + mock
│       ├── rag/pipeline.ts            # orchestrator
│       ├── services/ingestion.ts      # end-to-end ingest
│       ├── evaluation/metrics.ts      # recall, MRR, nDCG
│       ├── evaluation/corpus.ts       # sample eval set
│       ├── observability/metrics.ts   # in-process counters
│       ├── security/ratelimit.ts      # Upstash + in-memory
│       └── api/helpers.ts             # route wrapper + JSON helpers
├── docs/seed/                         # sample markdown corpus
├── scripts/
│   ├── smoke-test.ts                  # /api/health, /api/metrics, etc.
│   ├── seed-sample-corpus.ts          # upload docs/seed to a running server
│   └── run-evaluation.ts              # POST /api/evaluate and pretty-print
├── public/
├── .env.example
├── .eslintrc.json
├── .gitignore
├── LICENSE
├── next.config.mjs
├── package.json
├── postcss.config.mjs
├── tailwind.config.ts
├── tsconfig.json
└── vercel.json
```

---

## ⚙️ Configuration reference

All env vars are validated by `src/lib/env.ts`. Required vars throw on
runtime access if missing; everything else has a sensible default.

| Var                     | Default              | Description                                                                  |
|-------------------------|----------------------|------------------------------------------------------------------------------|
| `GEMINI_API_KEY`        | *required*           | https://aistudio.google.com/app/apikey                                       |
| `UPSTASH_VECTOR_REST_URL`| optional            | Upstash Vector REST endpoint                                                 |
| `UPSTASH_VECTOR_REST_TOKEN`| optional          | Upstash Vector REST token                                                    |
| `UPSTASH_REDIS_REST_URL`| optional             | Upstash Redis REST endpoint                                                  |
| `UPSTASH_REDIS_REST_TOKEN`| optional           | Upstash Redis REST token                                                     |
| `EMBEDDING_MODEL`       | `text-embedding-004` | Gemini embedding model                                                       |
| `EMBEDDING_DIM`         | `768`                | Vector dimension — must match the model                                     |
| `CHUNK_SIZE`            | `800`                | Approx. tokens per chunk                                                     |
| `CHUNK_OVERLAP`         | `120`                | Approx. tokens of overlap between chunks                                     |
| `LLM_MODEL`             | `gemini-1.5-flash`   | Gemini model for grounded generation                                         |
| `LLM_TEMPERATURE`       | `0.2`                | Lower = more deterministic answers                                           |
| `LLM_MAX_OUTPUT_TOKENS` | `1024`               | Cap on answer length                                                         |
| `TOP_K`                 | `8`                  | Chunks passed to the LLM                                                     |
| `MIN_RELEVANCE_SCORE`   | `0.5`                | Drop chunks below this cosine similarity                                     |
| `RATE_LIMIT_PER_MINUTE` | `60`                 | Per-IP request quota                                                         |
| `ALLOW_MOCK_MODE`       | `true`               | When true, missing services auto-fall-back to deterministic stubs           |
| `NODE_ENV`              | `development`        | Set automatically by Vercel / `next start`                                  |

---

## 🛡️ Security notes

- **Secrets** never ship to the client. The frontend never receives API keys;
  all calls go through Next.js API routes.
- **CORS** is open for development. Tighten `corsHeaders()` in
  `src/lib/api/helpers.ts` before production use.
- **Rate limiting** is per-IP. If you need authenticated per-user limits, layer
  them on top.
- **File uploads** are accepted up to Vercel's body size limit (4.5MB on the
  Hobby plan, larger on Pro). Configure in `next.config.mjs`
  (`serverActions.bodySizeLimit`) and `vercel.json` (`functions.*.maxDuration`).

---

## 🧠 Design philosophy

- **Serverless-first.** No long-running processes, no native dependencies, no
  filesystem state. State lives in Upstash (managed Redis + Vector). Survives
  cold starts, scales to zero, costs nothing when idle.
- **Production observability, not vibes.** Every request gets a trace ID. Every
  pipeline stage times itself. `/api/metrics` reports real numbers, not
  approximations.
- **Modular RAG core.** `embedder`, `vectorStore`, `retriever`, `llm` all
  implement abstract interfaces. Swap Gemini for OpenAI by changing one line
  in `getEmbedder()`.
- **Mock mode by default.** Never let missing secrets block dev or CI. The UI
  always works; production services are wired up only when they're actually
  configured.
- **Honest evaluation.** Built-in eval reports real retrieval quality and
  citation precision, not hand-wavy scores. Replace the sample corpus with
  your own to measure what actually matters.

---

## 🚧 Roadmap

- [ ] Cross-encoder reranking (e.g. `cross-encoder/ms-marco-MiniLM`)
- [ ] Streaming LLM responses (server-sent events)
- [ ] Multi-tenant KB isolation (per-tenant vector namespaces)
- [ ] Anthropic Claude + OpenAI adapters
- [ ] Document Q&A history (per-user conversation persistence)
- [ ] Webhook callbacks for batch ingest jobs
- [ ] Built-in admin dashboard with key rotation

---

## 📄 License

MIT — see [LICENSE](./LICENSE).