// 13th-month pay (PR-080): half-up of total basic over runs paid in the year ÷ 12.
import { divRound } from "./engine.ts";
import type { Centavos, IsoDate } from "./types.ts";

export function thirteenthMonth(runs: { payday: IsoDate; basic: Centavos }[], year: number): Centavos {
  const total = runs.filter((r) => r.payday.startsWith(`${year}-`)).reduce((s, r) => s + r.basic, 0);
  return divRound(BigInt(total), 12n);
}
