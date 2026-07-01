/**
 * Seed the running deployment with the sample corpus in docs/seed/.
 *
 * Usage:
 *   tsx scripts/seed-sample-corpus.ts                       # local
 *   BASE_URL=https://my-rag.vercel.app tsx scripts/seed-sample-corpus.ts
 */

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dirname, "..", "docs", "seed");

async function main() {
  const files = await readdir(SEED_DIR);
  const targets = files.filter((f) => /\.(md|txt)$/.test(f));
  if (targets.length === 0) {
    console.log(`No seed documents found in ${SEED_DIR}`);
    return;
  }

  const form = new FormData();
  for (const f of targets) {
    const buf = await readFile(join(SEED_DIR, f));
    form.append("files", new Blob([buf]), f);
  }

  console.log(`Uploading ${targets.length} seed document(s) to ${BASE_URL}…`);
  const res = await fetch(`${BASE_URL}/api/ingest`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});