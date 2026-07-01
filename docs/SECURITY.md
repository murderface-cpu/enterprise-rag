# Security model

A short, honest summary of what this system does and doesn't protect against.

## What it does

- **Secrets stay server-side.** The browser never sees API keys. All calls to
  Gemini and Upstash happen inside Next.js API routes.
- **Per-IP rate limiting.** `RATE_LIMIT_PER_MINUTE` (default 60) caps each
  source IP at 60 requests per minute. Above that, 429s are returned.
- **Fail-open on rate-limit errors.** If Upstash is unreachable, requests are
  allowed through. Better to serve traffic than to lock everyone out because
  of a quota service outage.
- **Structured logs.** Every request logs trace ID, route, method, latency,
  and any errors. Easy to ship to Datadog / Axiom / CloudWatch.
- **Content-hash-based KB deduplication.** SHA-256 over normalized text
  prevents duplicate chunks and lets us detect modified files for re-ingestion.
- **Body size limits.** `serverActions.bodySizeLimit` in `next.config.mjs`
  caps uploads at 10MB. Adjust to your tier.
- **Cleaned text input.** `cleanText()` strips null bytes, normalizes
  whitespace, decodes common HTML entities. Defends against accidentally
  injecting raw control characters into the vector store.

## What it doesn't do (yet)

- **Authentication.** There is no user concept. Anyone who can reach the URL
  can upload documents, query the KB, or wipe the store. **Add auth before
  exposing this on a public URL.**
- **Multi-tenancy.** All users share one KB. For per-tenant isolation, add a
  `tenantId` to `DocumentMetadata` and `ChunkMetadata`, then pass it as a
  filter on every retrieval.
- **Prompt-injection defense.** The system prompt forbids answering from
  external knowledge, but a determined attacker could craft documents that
  override the LLM's instructions. Mitigations to consider:
  - Strip embedded "ignore previous instructions" patterns during ingestion
  - Use a separate, locked-down model for retrieval-quality judgment
  - Cap answer length so a long injection can't be smuggled through
- **DDoS protection.** Vercel provides some; Cloudflare in front of the
  domain is recommended for high-value deployments.
- **Audit log.** We track request counts and latency but not "who asked
  what". Add an append-only audit log table if compliance requires it.

## Recommended hardening for production

1. **Add auth**: NextAuth.js, Clerk, or a custom JWT layer in
   `src/middleware.ts`. Gate every API route.
2. **Add a tenant filter**: every `RAGQuery` includes `filter: { tenantId }`.
   Every `ingestFiles` call writes the tenant into `DocumentMetadata`.
3. **Add an audit log**: Redis-backed append-only log of (user, action,
   timestamp, docId, queryHash).
4. **Restrict CORS**: change `Access-Control-Allow-Origin: *` in
   `src/lib/api/helpers.ts` to your frontend origin only.
5. **Add content moderation**: pre-process uploads through a safety model
   (Gemini has one) to flag PII, hate speech, etc.
6. **Add quota tracking**: per-user counters, not just per-IP.

## Reporting issues

If you find a security issue, please open a private issue or contact the
maintainers directly. Public disclosure should wait for a fix.