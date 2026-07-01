# Deployment guide

This file documents the production deployment path for the RAG system. The
short version is in the main README; this is the long version.

## Why Vercel?

Vercel is the best place to deploy a Next.js app because:

1. **Zero ops**: no Docker, no Kubernetes, no CI to maintain.
2. **Edge runtime**: API routes spin up close to the user.
3. **Built-in preview URLs**: every PR gets its own URL.
4. **Generous free tier**: enough for low-traffic demos and personal projects.
5. **Environment variable management**: secrets stay in the dashboard, never
   in your git history.

## Production dependencies

Persistent production needs Upstash Vector + Redis and one generation provider.
Embeddings can run in-process with **no key at all**.

### 1. Generation: Groq (recommended) or Gemini

- **Groq URL**: https://console.groq.com/keys
- **What you need**: `GROQ_API_KEY`. The default model is `openai/gpt-oss-20b`
  over the OpenAI-compatible endpoint. Generous free tier.
- Alternatively set `GEMINI_API_KEY` to generate with Gemini 1.5 Flash.

### 2. Embeddings: local model (default) or Gemini

- **Default (`EMBEDDING_PROVIDER=auto`, no Gemini key)**: `Xenova/bge-base-en-v1.5`
  runs in-process with no key and no external service. The first request per cold
  instance downloads the model (~90 MB) to `/tmp` (~35 s), then it's warm.
- Set `GEMINI_API_KEY` (and leave `EMBEDDING_PROVIDER=auto`) to use Gemini
  `text-embedding-004` instead.

### 3. Upstash Vector

- **URL**: https://console.upstash.com/vector
- **What you need**: a **dense** or **hybrid** (dense + sparse) index with cosine
  similarity. Both are auto-detected. **Set `EMBEDDING_DIM` to the index's
  dimension**; the embedder pads/truncates BGE's 768d output to fit (e.g. a
  1536-dim hybrid index → `EMBEDDING_DIM=1536`).
- **Free tier**: 10,000 vectors, 100K queries/month, fine for small corpora
- **Latency**: ~50ms p50 from edge

### 4. Upstash Redis

- **URL**: https://console.upstash.com/redis
- **What you need**: create a database (any region). Stores per-session KB state.
- **Free tier**: 10K commands/day, 256MB storage, plenty for KB state
- **Latency**: ~10ms p50

## Vercel project setup

1. **Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin git@github.com:murderface-cpu/enterprise-rag.git
   git push -u origin main
   ```

2. **Import to Vercel**:
   - Visit https://vercel.com/new
   - Select the GitHub repo
   - Vercel auto-detects Next.js; no config changes needed
   - Click **Deploy**

3. **Add environment variables** in **Project Settings → Environment Variables**:

   | Variable                       | Environments       | Notes                              |
   |--------------------------------|--------------------|------------------------------------|
   | `GROQ_API_KEY`                 | Production, Preview, Development | Or `GEMINI_API_KEY` for generation |
   | `UPSTASH_VECTOR_REST_URL`      | Production, Preview, Development |                                    |
   | `UPSTASH_VECTOR_REST_TOKEN`    | Production, Preview, Development |                                    |
   | `UPSTASH_REDIS_REST_URL`       | Production, Preview, Development |                                    |
   | `UPSTASH_REDIS_REST_TOKEN`     | Production, Preview, Development |                                    |
   | `ALLOW_MOCK_MODE`              | Production          | Set to `false` to require real services |
   | `EMBEDDING_DIM`                | Production, Preview, Development | Must equal your Upstash index dimension |

4. **Redeploy** so the env vars take effect.

5. **Verify**:
   ```bash
   curl https://your-project.vercel.app/api/health
   # → {"status":"ok","checks":{"vector_store":"ok","kb_manager":"ok"},...}
   ```

## Cost estimate

For a small-to-medium enterprise deployment (10K docs, 100K queries/month):

| Service     | Free tier covers | Paid tier cost      |
|-------------|------------------|---------------------|
| Vercel      | 100 GB-hours     | $20/mo Pro plan     |
| Embeddings  | Free (in-process) | $0 (or Gemini pay-as-you-go if used) |
| Groq        | Generous free tier | Pay-as-you-go per token |
| Upstash Vec | 100K queries     | $0.20 per 100K queries |
| Upstash Red | 10K commands/day | $0.20 per 100K commands |

Total realistic cost at moderate scale: **$20-40/month** (local embeddings and
Groq's free tier keep the generation/embedding cost near zero for demos).

## What to monitor in production

- **Vercel dashboard**: function invocations, cold starts, error rate
- **Upstash dashboards**: query volume, cache hit rate, p99 latency
- **Groq / Gemini dashboard**: request count, token usage
- **Application-level**:
  - `GET /api/metrics` returns per-route counts and average latency
  - `GET /api/health` is your uptime probe
  - Structured logs in `vercel logs --follow` show every request's trace ID

## Going further

- **Multiple regions**: edit `regions` in `vercel.json`. Each region runs its
  own serverless instances but Upstash is global.
- **Custom domain**: Vercel project settings → Domains. Free SSL included.
- **Authentication**: add NextAuth or Clerk middleware in `src/middleware.ts`
  to gate the UI and API routes. The current build is open by design.
- **Larger uploads**: increase `serverActions.bodySizeLimit` in
  `next.config.mjs`. Vercel Pro supports 100MB request bodies.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `/api/health` returns 503 | A service is unreachable | Check Upstash / Groq status pages |
| All queries return "I don't know" | Nothing uploaded in *this* session, or `MIN_RELEVANCE_SCORE` too high | Upload docs (retrieval is session-scoped), lower the env var |
| `Invalid vector dimension: 768, expected: N` on ingest | `EMBEDDING_DIM` doesn't match the Upstash index | Set `EMBEDDING_DIM=N` to match the index |
| `This index requires sparse vectors` | Hybrid index but the code didn't detect it | Ensure `EMBEDDING_DIM` matches; the store adds a sparse vector automatically on hybrid indexes |
| `require() of ES Module @xenova/transformers` on Vercel | transformers.js not externalized correctly | Confirm it's in `experimental.serverComponentsExternalPackages` in `next.config.mjs` |
| TypeScript build fails | Stale `node_modules` | `rm -rf node_modules .next && npm install` |
| First request is slow (~35s) | Cold-start embedding-model download to `/tmp` | Expected once per cold instance; subsequent requests are fast |
| Groq/Gemini 429s | Hit per-minute quota | Upgrade tier or add request caching |