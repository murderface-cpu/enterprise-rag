/**
 * Built-in evaluation corpus.
 *
 * A small but realistic set of (question, expected source, expected answer)
 * tuples shipped with the app so the /api/evaluate endpoint and the
 * `npm run eval` script can produce meaningful numbers out-of-the-box.
 *
 * Replace with your own domain-specific set when shipping to production.
 */

export interface EvalCase {
  question: string;
  relevantDocIds?: string[];
  expectedAnswerSubstrings?: string[];
}

export const DEFAULT_EVAL_CORPUS: EvalCase[] = [
  {
    question: "What is Retrieval-Augmented Generation?",
    relevantDocIds: ["rag-overview.md"],
    expectedAnswerSubstrings: ["retrieval", "generation", "context"],
  },
  {
    question: "How does the knowledge base stay up to date?",
    relevantDocIds: ["ingestion-lifecycle.md"],
    expectedAnswerSubstrings: ["incremental", "content hash", "vector store"],
  },
  {
    question: "Which vector database does this system use?",
    relevantDocIds: ["architecture.md"],
    expectedAnswerSubstrings: ["Upstash Vector", "managed"],
  },
  {
    question: "How is the answer grounded in the sources?",
    relevantDocIds: ["grounding-and-citations.md"],
    expectedAnswerSubstrings: ["context only", "citation", "[1]"],
  },
  {
    question: "What chunking strategy is used?",
    relevantDocIds: ["architecture.md"],
    expectedAnswerSubstrings: ["recursive", "overlap"],
  },
];