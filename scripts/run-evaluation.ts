/**
 * Run the built-in evaluation corpus against the running deployment.
 *
 * Usage:
 *   tsx scripts/run-evaluation.ts
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

async function main() {
  console.log(`\nEvaluating ${BASE_URL} …\n`);
  const res = await fetch(`${BASE_URL}/api/evaluate`, { method: "POST" });
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const data = await res.json();
  console.log(JSON.stringify(data.summary, null, 2));
  console.log("\nPer-query breakdown:");
  for (const row of data.perQuery) {
    console.log(
      `  ${row.question.padEnd(48)} recall=${row.retrieval.recall_at_k.toFixed(2)} mrr=${row.retrieval.mrr.toFixed(2)} ndcg=${row.retrieval.ndcg_at_k.toFixed(2)} lat=${row.latencyMs.toFixed(0)}ms`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});