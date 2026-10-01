// Stable fingerprint of a PeriodInput: same inputs → same hash (stale-draft detection, Data Model note 3).
import { createHash } from "node:crypto";
import type { PeriodInput } from "./types.ts";

/** JSON with object keys sorted at every level, so key order never changes the hash. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export function inputHash(input: PeriodInput): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}
