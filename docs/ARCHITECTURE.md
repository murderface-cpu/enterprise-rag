# Architecture deep-dive

A more detailed look at the design choices and trade-offs than the main README.

## Why TypeScript on Vercel and not Python on Fly.io?

This is the question that drove the rewrite. The honest answer:

| Concern                          | Python on Fly.io                     | TypeScript on Vercel               |
|----------------------------------|--------------------------------------|------------------------------------|
| Dev experience                   | Strong for ML, weaker for UI         | Single language across stack       |
| Production deployment            | Dockerfile, container registry       | git push → URL                     |
| Cold start                       | ~1-2s                                | ~50ms                              |
| State                            | Disk + DB                            | Managed services only              |
| Scaling                          | Manual horizontal                    | Automatic, per-route               |
| UI                               | Separate React app                   | Same codebase, no CORS issues      |
| Observability                    | DIY                                  | Built-in logs + custom             |
| Cost at idle                     | $0 if scaled to zero                 | $0                                 |

For an *enterprise RAG system*, the RAG part is just one piece. The UI,
the API, the auth, the rate limiting, the deployment: those dominate the
engineering effort. Doing them in a single TypeScript codebase with
zero ops outweighs the marginal "easier to write Python ML code" advantage.

## Why Upstash Vector over Pinecone / Weaviate / Qdrant?

- **Pinecone**: requires its own API key, has its own SDK, runs on AWS only
  (not edge-friendly). Works well but adds another vendor.
- **Weaviate**: needs Docker/Kubernetes to run. Heavy.
- **Qdrant**: similar story.
- **Upstash Vector**: REST-only, edge-friendly, single REST URL + token. The
  integration is ~5 lines of code. Free tier is enough for the demo and most
  small corpora.

If you outgrow Upstash, the `BaseVectorStore` interface is small enough that
swapping in Pinecone or Weaviate is a one-file change.

## How embeddings work (local model vs Gemini)

`getEmbedder()` resolves a provider from `EMBEDDING_PROVIDER`:

- **`local` (default when there's no Gemini key)**: `LocalEmbedder` runs
  `Xenova/bge-base-en-v1.5` (768d) in-process via ONNX (`@xenova/transformers`).
  The model is fetched once and cached to a writable temp dir (`/tmp` on
  serverless), so semantic search works with **no embedding API key at all**.
  Queries get the BGE retrieval instruction prefix; passages do not.
- **`gemini`**: `GeminiEmbedder` calls `text-embedding-004`.
- **`mock`**: deterministic hash vectors, for offline CI only.

The embedder is **dimension-adaptive**: `_fit()` zero-pads a shorter vector to
`EMBEDDING_DIM` (lossless for cosine similarity, since appended zeros change
neither dot products nor norms) or truncates+renormalizes a longer one. That's
how a 768d BGE model can populate a 1536d index without loss of ranking quality.

`@xenova/transformers`, `onnxruntime-node`, and `sharp` are declared in
`experimental.serverComponentsExternalPackages` in `next.config.mjs`. The
package is ESM-only, and bundling it as a plain webpack external emits a
`require()` that throws on Vercel's CommonJS runtime; externalizing it the
Next.js way preserves the dynamic `import()`.

## How generation works (Groq vs Gemini)

`getLLM()` prefers **Groq** (`openai/gpt-oss-20b`, via the OpenAI-compatible
endpoint) when `GROQ_API_KEY` is set, falls back to the extractive `MockLLM` in
mock mode, and uses **Gemini** for a fully-configured deployment. All three
implement the same `generate()` contract, and `buildUserPrompt()` /
`extractCitations()` are shared so the grounding prompt and citation parsing are
identical across providers. Note that `gpt-oss` is a reasoning model, so free-form
calls (e.g. eval question generation) give it a generous token budget so its
reasoning doesn't starve the visible output.

## Why hybrid retrieval (dense + BM25 + optional sparse index)?

Pure dense retrieval fails on enterprise corpora in two predictable ways:

1. **Exact technical terms**: SKU codes, error strings, internal jargon. The
   embedding model de-emphasizes these because they don't co-occur with
   anything semantically meaningful.
2. **Acronyms**: "KPI", "SLA", "API". Each acronym has many senses; the
   embedding model can't disambiguate without context.

BM25 (classic keyword scoring) catches both. There are **two** hybrid layers:

- **In-process** (`HybridRetriever`): BM25 runs over the dense candidates and is
  fused with the dense ranking via reciprocal rank fusion (RRF), weighted 70%
  dense / 30% BM25. Final scores are re-normalized to `[0,1]` for the confidence
  badge. This runs against any vector store.
- **Server-side** (Upstash hybrid index): when `index.info()` reports a sparse
  component, `UpstashVectorStore` also builds a custom sparse vector
  (`encodeSparse`, a hashed-token term-frequency bag-of-words) and sends it with
  the dense vector. Upstash fuses them with RRF and applies BM25-style `IDF`
  weighting to the sparse side server-side. Because the fused RRF scores are
  tiny (~0.03) and not comparable to cosine, the `MIN_RELEVANCE_SCORE` filter is
  skipped for hybrid indexes; the in-process retriever re-ranks and
  re-normalizes anyway.

Both index shapes (dense-only and hybrid) are auto-detected, so the same code
works against either.

## Why recursive chunking?

Fixed-size chunking is fast but it cuts sentences in half. The first sentence
of a chunk often makes a question completely unanswerable because the
question's noun is in the next chunk.

Recursive chunking tries paragraph breaks first, then sentence breaks, then
word breaks. It respects document structure without writing a full parser.
Result: 80%+ of chunks end on natural boundaries, which dramatically
improves answer quality in informal evals.

The trade-off: recursive chunking is slower (more string operations) and the
chunk-size distribution is wider. For ~10K-token documents, this is a wash.
For >100K-token documents, consider switching to semantic chunking (cluster
embeddings, cut between clusters).

## Why these particular env defaults?

| Default                | Why                                                                              |
|------------------------|----------------------------------------------------------------------------------|
| `CHUNK_SIZE=800`       | Gemini's context window is 1M tokens but retrieval quality peaks around 500-1000 |
| `CHUNK_OVERLAP=120`    | 15% overlap: enough context bleed for cross-chunk references, not wasteful      |
| `TOP_K=8`              | Enough for the LLM to see alternatives, small enough to fit in the prompt easily |
| `MIN_RELEVANCE_SCORE=0.5` | Filters noisy matches on dense-only indexes (Upstash cosine, 0–1); skipped for hybrid |
| `LLM_TEMPERATURE=0.2`  | Low enough to be deterministic, high enough to not be repetitive                |
| `LLM_MAX_OUTPUT_TOKENS=1024` | Covers most Q&A answers; longer answers are usually hallucinations         |

All of these are overridable via env vars. Adjust to your domain.

## Why explicit observability fields?

The `observability` block in `/api/query` returns:

- `traceId`: for log correlation across ingestion, embedding, retrieval, LLM
- `retrievalLatencyMs`: pure retrieval cost (excluding LLM)
- `generationLatencyMs`: pure LLM cost
- `totalLatencyMs`: end-to-end
- `numRetrieved`: how many chunks actually passed the relevance filter
- `avgRelevance`: average cosine similarity of returned chunks
- `confidence`: heuristic (`low` / `medium` / `high`)
- `model`: which LLM actually served the request
- `groundedOnly`: `true` if the answer references at least one source

These fields are surfaced in the UI as badges. They give users (and you, when
debugging) instant feedback on whether the system is hallucinating, returning
empty results, or confidently grounded.

## How session isolation works

The system is single-instance multi-tenant: every visitor's documents live in
the *same* Upstash index and Redis, but are kept separate by session.

- The `withRoute` wrapper mints an httpOnly `sid` cookie on first contact and
  hands each handler a `RouteContext { sessionId }`. Browsers replay the cookie
  automatically, so no frontend change was needed.
- **Ingestion** stamps `sessionId` into each document's (and chunk's) metadata,
  and derives the document id from the session, so two sessions uploading the
  same file get disjoint chunk ids in the shared vector index.
- **Retrieval** always adds `filter: { sessionId }`, so a query only ever sees
  its own session's vectors.
- **KB state** is namespaced per session in Redis (`rag:kb:<session>:*`), or held
  as a per-session `InMemoryKBManager` in mock mode.
- **List / delete / metrics / reset** are all scoped. Notably, "clear all" only
  deletes the caller's documents; it never calls `vectorStore.reset()`, which
  would wipe every session's data from the shared index.

This is convenience isolation, not authentication: a visitor who clears their
cookie starts fresh. Bind sessions to real identities (NextAuth/Clerk) before
exposing the app publicly.

## What "mock mode" actually does

When `ALLOW_MOCK_MODE=true` and managed Upstash credentials are missing, the
storage factories return in-process stubs, but embeddings and generation still
use whatever real providers are configured:

- `InMemoryVectorStore`: keeps vectors in a process-local array (held on
  `globalThis` so all route bundles share one instance). Reset on cold start.
- `InMemoryKBManager`: per-session in-memory document registry.
- `InMemoryLimiter`: token bucket per IP.
- `LocalEmbedder` still runs the real BGE model, so semantic search works even
  with zero keys. `MockEmbedder` (deterministic hash vectors) is only used when
  `EMBEDDING_PROVIDER=mock`.
- `MockLLM` (extractive: top sentences by question overlap) is used only when no
  Groq/Gemini key is present; set `GROQ_API_KEY` for real grounded answers.

This makes the app fully functional on a fresh clone with no secrets, and is
what makes `npm run dev` Just Work.

## Why this isn't LangChain

LangChain is a fine library but it adds abstraction that obscures what's
actually happening. For a production system you want to be able to:

1. Read the code and understand exactly what runs
2. Swap any component (embedder, vector store, retriever, LLM) without
   touching the rest
3. Add custom logic (like our hybrid retriever) without fighting the framework

This codebase is ~3000 lines of TypeScript with zero magic. Every module is
~100-300 lines. You can read the whole thing in an afternoon.

If you find yourself wanting the LangChain tool ecosystem (agents, memory,
chains-of-thought), reach for it then. For a focused Q&A RAG, hand-rolled
is the right choice.