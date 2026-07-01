# Deployment

The system is built to run on **Vercel** with zero infrastructure to manage:

1. Push the repo to GitHub.
2. Import into Vercel; it auto-detects Next.js.
3. Add the following env vars in the Vercel dashboard:
   - `GROQ_API_KEY` (or `GEMINI_API_KEY`) for grounded answers
   - `UPSTASH_VECTOR_REST_URL`
   - `UPSTASH_VECTOR_REST_TOKEN`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `EMBEDDING_DIM` matching your Upstash index dimension
4. Deploy.

## What's where

- All API routes (`/api/*`) are serverless functions: autoscale from zero.
- The vector store and KB state live in **Upstash** (free tier covers most
  small-to-medium enterprise corpora).
- Embeddings run in-process (no key needed); a generation key (Groq or Gemini)
  is the only thing you must procure separately.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in keys
npm run dev
```

With no keys set, the app runs in **mock mode**: the vector store and KB are
in-process and the LLM does extractive summarization, but embeddings still use
the real in-process model, so semantic search works. Add a Groq key for real
grounded answers. Great for testing the UI before you wire up real services.