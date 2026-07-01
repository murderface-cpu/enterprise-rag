# Evaluation guide

The system ships with a built-in evaluation layer. This document explains
what it measures, why those metrics matter, and how to write your own
evaluation corpus.

## What it measures

### Retrieval quality

These metrics answer "did we find the right chunks?"

- **Recall@K** — fraction of known-relevant documents that appear in the
  top-K retrieved results. If you marked doc A as relevant and it shows up
  in positions 1-3 of K=5, you got 100% recall. If it doesn't appear in
  positions 1-5, you got 0%.
- **MRR (Mean Reciprocal Rank)** — 1 / (position of first relevant result).
  Rewards ranking the right answer first. MRR=1.0 means perfect; MRR=0.33
  means the right answer was at position 3.
- **nDCG@K (Normalized Discounted Cumulative Gain)** — like MRR but accounts
  for the *quality* of the ranking, not just the first hit. nDCG=1.0 means
  perfect ranking; 0 means the relevant documents were at the bottom.

### Generation quality

- **Citation precision** — of the chunks the LLM cited (e.g. `[1]`, `[2]`),
  how many actually contain content matching the expected answer?
- **Grounded fraction** — fraction of queries where the LLM's response
  includes at least one citation. Low grounded fraction = the LLM is
  answering from its own knowledge instead of the documents — a red flag.

### Operational quality

- **p50 / p95 latency** — middle and tail latency. p95 tells you what your
  worst 1-in-20 requests feel like.
- **Average latency** — overall throughput character.

## Running the built-in evaluation

```bash
npm run seed     # uploads docs/seed/* to a running server
npm run eval     # runs the eval corpus and prints the summary
```

The built-in corpus lives in `src/lib/evaluation/corpus.ts`. It has 5
questions targeting the sample seed documents.

## Writing your own evaluation corpus

The hard part of any RAG evaluation is the corpus itself. A good corpus:

1. **Has at least 30-50 questions.** Anything smaller has too much variance.
2. **Mixes difficulty.** Include easy questions (single keyword match),
   medium (paraphrase), and hard (multi-hop reasoning).
3. **Marks relevance correctly.** If you say a document is relevant, the
   answer must actually be in that document.
4. **Provides expected substrings.** These let citation precision be measured.

Example:

```ts
{
  question: "What chunk size does the system use by default?",
  relevantDocIds: ["architecture.md"],
  expectedAnswerSubstrings: ["800", "tokens"],
},
{
  question: "How do I deploy this to Vercel?",
  relevantDocIds: ["deployment.md"],
  expectedAnswerSubstrings: ["Vercel", "git push"],
},
```

Replace `src/lib/evaluation/corpus.ts` (or pass a custom corpus via the
`POST /api/evaluate` body) with your domain-specific set.

## Interpreting results

A rough quality guide:

| Metric                       | Bad  | OK   | Good |
|------------------------------|------|------|------|
| Recall@5                     | <0.5 | 0.7  | >0.85 |
| MRR                          | <0.4 | 0.6  | >0.8 |
| nDCG@5                       | <0.5 | 0.7  | >0.85 |
| Citation precision           | <0.4 | 0.6  | >0.8 |
| Grounded fraction            | <0.7 | 0.9  | 1.0  |
| p50 latency (s)              | >3   | 1-3  | <1   |
| p95 latency (s)              | >8   | 3-8  | <3   |

If you're below "OK" on any metric, fix that metric specifically:

- **Low recall**: improve chunking (smaller chunks, more overlap), improve
  embeddings (try a different model), or add reranking.
- **Low MRR / nDCG**: improve ranking — add a cross-encoder reranker, tune
  the dense/BM25 weights in `HybridRetriever`.
- **Low citation precision**: tighten the system prompt, lower the LLM
  temperature, or restrict `TOP_K` so the LLM sees fewer options.
- **Low grounded fraction**: same as above. If the LLM still answers
  without citing, you're seeing hallucination.
- **High latency**: smaller `TOP_K`, smaller `CHUNK_SIZE`, fewer Gemini calls
  (cache embeddings, cache LLM responses).

## Continuous evaluation

Wire `POST /api/evaluate` into your CI:

```yaml
- run: npm run eval
  env:
    BASE_URL: https://my-rag.vercel.app
```

If any metric drops below threshold, fail the build. This catches regressions
when you change the system prompt, swap embeddings, or update chunking.

## Limits of this evaluation layer

- It measures *retrieval* and *citation* quality, but not *answer quality*
  directly. A perfect retrieval + perfect citation doesn't guarantee a
  perfect answer.
- It uses substring matching for citation precision. A real answer might
  paraphrase the source instead of using the same words.
- It's not adversarial. A determined user can find queries that break the
  system in ways the eval doesn't cover.

For deeper evaluation, integrate with tools like:
- **RAGAS** — automatic reference-free evaluation
- **LangSmith** — traces + scoring
- **Braintrust** — eval suites + regression tracking

These complement (don't replace) the in-built layer.