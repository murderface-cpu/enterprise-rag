# Deployment guide

This file documents the production deployment path for the RAG system. The
short version is in the main README; this is the long version.

## Why Vercel?

Vercel is the best place to deploy a Next.js app because:

1. **Zero ops** — no Docker, no Kubernetes, no CI to maintain.
2. **Edge runtime** — API routes spin up close to the user.
3. **Built-in preview URLs** — every PR gets its own URL.
4. **Generous free tier** — enough for low-traffic demos and personal projects.
5. **Environment variable management** — secrets stay in the dashboard, never
   in your git history.

## Production dependencies

The system needs three external services:

### 1. Google Gemini API

- **URL**: https://aistudio.google.com/app/apikey
- **What you need**: an API key (free tier covers small workloads)
- **Latency**: ~150ms first byte for embeddings, ~500ms for generation
- **Cost**: free tier is 60 requests/minute; paid tier is pay-as-you-go

### 2. Upstash Vector

- **URL**: https://console.upstash.com/vector
- **What you need**: create an index with dimension 768 and cosine similarity
- **Free tier**: 10,000 vectors, 100K queries/month — fine for small corpora
- **Latency**: ~50ms p50 from edge

### 3. Upstash Redis

- **URL**: https://console.upstash.com/redis
- **What you need**: create a database (any region)
- **Free tier**: 10K commands/day, 256MB storage — plenty for KB state
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
   - Vercel auto-detects Next.js — no config changes needed
   - Click **Deploy**

3. **Add environment variables** in **Project Settings → Environment Variables**:

   | Variable                       | Environments       |
   |--------------------------------|--------------------|
   | `GEMINI_API_KEY`               | Production, Preview, Development |
   | `UPSTASH_VECTOR_REST_URL`      | Production, Preview, Development |
   | `UPSTASH_VECTOR_REST_TOKEN`    | Production, Preview, Development |
   | `UPSTASH_REDIS_REST_URL`       | Production, Preview, Development |
   | `UPSTASH_REDIS_REST_TOKEN`     | Production, Preview, Development |

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
| Gemini      | ~1500 queries/day | ~$0.50 per 1M chars  |
| Upstash Vec | 100K queries     | $0.20 per 100K queries |
| Upstash Red | 10K commands/day | $0.20 per 100K commands |

Total realistic cost at moderate scale: **$20-40/month**.

## What to monitor in production

- **Vercel dashboard** — function invocations, cold starts, error rate
- **Upstash dashboards** — query volume, cache hit rate, p99 latency
- **Gemini dashboard** — request count, token usage
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
| `/api/health` returns 503 | One of the services is unreachable | Check Upstash / Gemini status pages |
| All queries return "I don't know" | KB is empty or `MIN_RELEVANCE_SCORE` is too high | Run `npm run seed` to load samples, lower the env var |
| TypeScript build fails | Stale `node_modules` | `rm -rf node_modules .next && npm install` |
| First request is slow | Cold start | First request primes everything; subsequent are fast |
| Gemini 429s | Hit per-minute quota | Upgrade to paid tier or add request caching |