/**
 * Smoke test for the running API.
 *
 * Usage:
 *   tsx scripts/smoke-test.ts                              # against local dev server
 *   BASE_URL=https://my-rag.vercel.app tsx scripts/smoke-test.ts
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

interface SmokeResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: SmokeResult[] = [];

async function step(name: string, fn: () => Promise<void>) {
  process.stdout.write(`→ ${name}…`);
  try {
    await fn();
    results.push({ name, ok: true });
    process.stdout.write(" ✅\n");
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, ok: false, detail });
    process.stdout.write(` ❌\n   ${detail}\n`);
  }
}

async function main() {
  console.log(`\nSmoke test against ${BASE_URL}\n`);

  await step("GET /api/health", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!body.status) throw new Error("missing status");
  });

  await step("GET /api/metrics", async () => {
    const res = await fetch(`${BASE_URL}/api/metrics`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (typeof body.totalDocuments !== "number") throw new Error("missing totalDocuments");
  });

  await step("GET /api/knowledge-base", async () => {
    const res = await fetch(`${BASE_URL}/api/knowledge-base`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body.documents)) throw new Error("documents is not an array");
  });

  await step("POST /api/query (mock question)", async () => {
    const res = await fetch(`${BASE_URL}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "What is RAG?", topK: 3 }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (typeof body.answer !== "string") throw new Error("missing answer");
    if (!body.observability?.traceId) throw new Error("missing traceId");
  });

  console.log("\nResults:");
  for (const r of results) {
    console.log(`  ${r.ok ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }

  const failed = results.filter((r) => !r.ok).length;
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(2);
});