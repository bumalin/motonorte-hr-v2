// Server-only helpers for payroll runs. NOT a "use server" module: nothing here is callable from the browser.
import { withUser } from "./client.ts";
import { loadPeriodInput } from "./loadPeriodInput.ts";
import { inputHash } from "../payroll/hash.ts";

/** Fingerprint of the run's week recomputed from live data (stale-draft check, Data Model note 3). */
export async function currentRunHash(userId: string, runId: string): Promise<{ hash: string; start: string } | null> {
  return withUser(userId, async (tx) => {
    const [r] = await tx<{ start: string }[]>`select period_start::text as start from payroll_runs where id = ${runId}`;
    return r ? { hash: inputHash(await loadPeriodInput(tx, r.start)), start: r.start } : null;
  });
}
