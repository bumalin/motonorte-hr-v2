// Report queries (US-040, US-041) over LOCKED runs only, attributed by payday (PR-011). Shared by pages and CSV exports.
import type { Tx } from "./client.ts";

export type MonthlyRow = { code: string; full_name: string; base: number; ot: number; incentive: number; allowances: number; deductions: number; carried_in: number; gross: number; net: number; carry_out: number };
export type ThirteenthRow = { code: string; full_name: string; total_basic: number; thirteenth: number };

export function monthlySummary(tx: Tx, month: string) {
  return tx<MonthlyRow[]>`
    select e.code, e.full_name, m.base::bigint, m.ot::bigint, m.incentive::bigint, m.allowances::bigint,
           m.deductions::bigint, m.carried_in::bigint, m.gross::bigint, m.net::bigint, m.carry_out::bigint
    from v_monthly_summary m join employees e on e.id = m.employee_id
    where m.month = ${month}::date order by e.code`;
}

export function thirteenthMonth(tx: Tx, year: number) {
  return tx<ThirteenthRow[]>`
    select e.code, e.full_name, t.total_basic::bigint, t.thirteenth
    from v_thirteenth_month t join employees e on e.id = t.employee_id
    where t.year = ${year} order by e.code`;
}

/** RFC 4180 CSV; money as pesos with 2 decimals. Cells starting with = + - @ are prefixed to stop spreadsheet formula injection. */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const pesos = (centavos: number) => (centavos / 100).toFixed(2);

/** "2026-10" → true only for months 01–12 of years 2000–2100. */
export const validMonth = (m: string) => /^(20\d\d|2100)-(0[1-9]|1[0-2])$/.test(m);
export const validYear = (y: number) => Number.isInteger(y) && y >= 2000 && y <= 2100;
