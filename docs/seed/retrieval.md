# Retrieval

The retriever uses a **hybrid** strategy that combines:

1. **Dense retrieval** via the Upstash Vector index using Gemini embeddings.
2. **BM25 keyword scoring** over the dense candidates, with reciprocal rank
   fusion (RRF) to merge the two rankings.

## Why hybrid?

Pure dense retrieval is great for paraphrased queries but can miss precise
technical terms (product codes, error strings, internal jargon). BM25 catches
those. RRF keeps the dense signal dominant (70% / 30% weights by default) but
gives BM25 enough rope to pull exact-match chunks up the ranking.

## Tunables

| Env var              | Default | Effect                                          |
|----------------------|---------|-------------------------------------------------|
| `TOP_K`              | 8       | Number of chunks returned to the LLM            |
| `MIN_RELEVANCE_SCORE`| 0.5     | Drop chunks below this similarity score         |
| `CHUNK_SIZE`         | 800     | Approx. tokens per chunk                        |
| `CHUNK_OVERLAP`      | 120     | Approx. tokens of overlap between chunks        |