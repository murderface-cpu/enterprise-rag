# Architecture

This system is built as a thin Next.js 14 application on Vercel, with all
stateful work delegated to managed services:

| Layer            | Technology                                     |
|------------------|------------------------------------------------|
| Frontend / API   | Next.js 14 App Router (React 18)               |
| Embeddings       | Google Gemini `text-embedding-004` (768 dim)   |
| Vector store     | Upstash Vector (managed, REST, serverless-safe)|
| KB state + cache | Upstash Redis                                  |
| Rate limiting    | Upstash Ratelimit                              |
| LLM              | Google Gemini 1.5 Flash                        |

## Why these choices

- **Upstash Vector** runs over HTTPS so it works from Vercel's edge and
  serverless runtimes. No filesystem, no native dependencies.
- **Upstash Redis** stores the document registry, chunk-id lists, and rate-limit
  state. Same edge-compatibility story.
- **Gemini** for both embeddings and generation keeps the bill low and the
  latency consistent.

## Request flow

```
Browser
   │  POST /api/query
   ▼
Next.js API route
   │  rate-limit → embed → retrieve (vector + BM25) → rerank → LLM → JSON
   ▼
Browser (answer + citations + observability)
```