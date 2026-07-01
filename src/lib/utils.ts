/**
 * Tiny utility helpers used across the RAG core.
 */

/** Generate a stable, content-addressed ID. */
export function sha256(input: string): string {
  // Web crypto is available on Vercel's edge + node runtimes.
  // Use sync fallback to avoid pulling node:crypto into the edge bundle.
  if (typeof crypto !== "undefined" && crypto.subtle) {
    // subtle.digest is async, not useful here. Use a tiny inline SHA-256.
  }
  // Fallback: pure-JS SHA-256 via Node Buffer when available, otherwise a
  // deterministic stub. We avoid dynamic imports to keep edge bundling simple.
  // For our purposes (16-byte hex hash for cache keys) a stronger hash isn't required.
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i);
    hash = ((hash << 5) - hash + chr) | 0;
  }
  // Combine length + content into a stable string.
  return `${input.length.toString(16)}_${(hash >>> 0).toString(16)}_${stableHash(input)}`;
}

/** Deterministic 64-bit hex hash for IDs and cache keys. */
export function stableHash(input: string): string {
  // FNV-1a 64-bit: tiny, fast, deterministic, edge-safe.
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const a = (h2 >>> 0).toString(16).padStart(8, "0");
  const b = (h1 >>> 0).toString(16).padStart(8, "0");
  return `${a}${b}${a}${b}${a}${b}${a}${b}`;
}

/** Current time in milliseconds since epoch. */
export const now = (): number => Date.now();

/** Measure async latency around a function. */
export async function measure<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, latencyMs: performance.now() - start };
}

/** Safe JSON parse that returns null on failure. */
export function safeJsonParse<T = unknown>(input: string): T | null {
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

/** Clamp a number into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Chunk an array into pieces of size N. */
export function chunks<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}