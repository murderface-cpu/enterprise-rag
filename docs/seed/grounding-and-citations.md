# Grounding & citations

Every answer is generated with a strict system prompt:

> Answer the user's question using ONLY the provided context. Cite every
> factual claim with `[1]`, `[2]`, … matching the context number. If the answer
> is not present in the context, say exactly:
> "I don't know based on the provided context."

This makes hallucination observable: if the answer doesn't reference `[1]`-style
tags, the user knows to be skeptical.

## How citations are computed

1. The retriever returns the top-K chunks ranked by relevance.
2. The LLM is shown each chunk as `[1] … [2] … [3] …`.
3. The pipeline regex-scans the LLM's output for `[N]` tags and returns the
   corresponding chunk metadata (source, chunk index, relevance score) as
   `citations[]`.
4. The UI renders each citation as a card with a snippet and score.

## Confidence

After retrieval, the pipeline reports a confidence label:

- **High**: avg relevance ≥ 0.70
- **Medium**: avg relevance ≥ 0.45
- **Low**: fewer than 3 hits, or low avg relevance

Use this to flag answers that need a human review.