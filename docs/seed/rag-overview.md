# What is Retrieval-Augmented Generation?

**Retrieval-Augmented Generation (RAG)** is an architecture that combines two
components:

1. A **retrieval system** — typically a vector search index over a document
   corpus — that, given a user question, returns the most semantically relevant
   chunks of text.
2. A **generative model** (an LLM) that produces an answer conditioned on those
   retrieved chunks.

The key property: the LLM is instructed to answer using *only* the provided
context. This grounds the response in real documents, which dramatically reduces
hallucination compared to a closed-book LLM call, and lets you update the
system's knowledge simply by adding or removing documents — no model
retraining required.

## Why it matters in production

- **Freshness**: answers reflect today's documents, not yesterday's training cutoff.
- **Attribution**: every claim can be cited back to a specific source chunk.
- **Privacy**: sensitive data stays in your vector store; the LLM only ever sees
  the snippets you choose to send it.
- **Cost**: you can use a smaller, cheaper LLM because the heavy lifting
  (knowing the facts) is done by retrieval.

A typical enterprise RAG stack looks like this:

```
User question → Embedding model → Vector search → Top-K chunks → LLM → Cited answer
```