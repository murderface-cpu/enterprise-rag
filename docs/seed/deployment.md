# Deployment

The system is built to run on **Vercel** with zero infrastructure to manage:

1. Push the repo to GitHub.
2. Import into Vercel; it auto-detects Next.js.
3. Add the following env vars in the Vercel dashboard:
   - `GEMINI_API_KEY`
   - `UPSTASH_VECTOR_REST_URL`
   - `UPSTASH_VECTOR_REST_TOKEN`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
4. Deploy.

## What's where

- All API routes (`/api/*`) are serverless functions: autoscale from zero.
- The vector store and KB state live in **Upstash** (free tier covers most
  small-to-medium enterprise corpora).
- The Gemini API key is the only thing you must procure separately.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in keys
npm run dev
```

With no keys set, the app runs in **mock mode**: embeddings are deterministic
hashes, the LLM does extractive summarization, and the vector store is in-process.
This is great for testing the UI before you wire up real services.