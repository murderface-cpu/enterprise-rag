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
the API, the auth, the rate limiting, the deployment — those dominate the
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

## Why hybrid retrieval (dense + BM25)?

Pure dense retrieval fails on enterprise corpora in two predictable ways:

1. **Exact technical terms** — SKU codes, error strings, internal jargon. The
   embedding model de-emphasizes these because they don't co-occur with
   anything semantically meaningful.
2. **Acronyms** — "KPI", "SLA", "API". Each acronym has many senses; the
   embedding model can't disambiguate without context.

BM25 (classic keyword scoring) catches both. Reciprocal rank fusion (RRF)
combines the two rankings without needing to normalize scores. The weights
default to 70% dense / 30% BM25, which empirically gives the best of both
worlds.

In production, BM25 runs over the dense candidates — we don't scan the whole
corpus twice. That keeps the per-query cost dominated by the vector search.

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
| `CHUNK_OVERLAP=120`    | 15% overlap — enough context bleed for cross-chunk references, not wasteful      |
| `TOP_K=8`              | Enough for the LLM to see alternatives, small enough to fit in the prompt easily |
| `MIN_RELEVANCE_SCORE=0.5` | Filters noisy matches without being too aggressive (Upstash cosine, 0–1)    |
| `LLM_TEMPERATURE=0.2`  | Low enough to be deterministic, high enough to not be repetitive                |
| `LLM_MAX_OUTPUT_TOKENS=1024` | Covers most Q&A answers; longer answers are usually hallucinations         |

All of these are overridable via env vars. Adjust to your domain.

## Why explicit observability fields?

The `observability` block in `/api/query` returns:

- `traceId` — for log correlation across ingestion, embedding, retrieval, LLM
- `retrievalLatencyMs` — pure retrieval cost (excluding LLM)
- `generationLatencyMs` — pure LLM cost
- `totalLatencyMs` — end-to-end
- `numRetrieved` — how many chunks actually passed the relevance filter
- `avgRelevance` — average cosine similarity of returned chunks
- `confidence` — heuristic (`low` / `medium` / `high`)
- `model` — which LLM actually served the request
- `groundedOnly` — `true` if the answer references at least one source

These fields are surfaced in the UI as badges. They give users (and you, when
debugging) instant feedback on whether the system is hallucinating, returning
empty results, or confidently grounded.

## What "mock mode" actually does

When `ALLOW_MOCK_MODE=true` and managed-service credentials are missing, the
factory functions return deterministic stubs:

- `MockEmbedder` — projects a TF vector through a hash function and normalizes.
  Two texts with overlapping tokens produce similar vectors (high cosine).
  Not semantically meaningful, but stable across runs.
- `MockLLM` — splits retrieved chunks into sentences, scores each by question
  overlap, returns the top 3 sentences verbatim. Always grounded.
- `InMemoryVectorStore` — keeps vectors in a process-local array. Reset on
  cold start. Useful for unit tests; not for production.
- `InMemoryKBManager` — same idea.
- `InMemoryLimiter` — token bucket per IP.

This makes the app fully functional on a fresh clone with no secrets. It's
also what makes `npm run dev` Just Work.

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