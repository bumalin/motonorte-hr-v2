// Plain-language text for payroll provenance items — shared by the run review drill-down and payslips (US-031, US-034).
import { formatDay, formatMoney } from "../format.ts";

export type RunItem = { employee_id: string; date: string | null; kind: string; amount: number; rule_id: string; source: Record<string, unknown> };

const TYPE: Record<string, string> = { meal: "Meal", transport: "Transport", cash_advance: "Cash advance", clawback: "Clawback", correction: "Correction", other: "Other", back_pay: "Back pay" };


/** Plain-language line for one provenance item (US-031 drill-down). */
export function describeItem(it: RunItem): string {
  const s = it.source as Record<string, never>;
  const day = it.date ? `${formatDay(it.date)} — ` : "";
  const mult = (m: number) => (m && m !== 10000 ? ` × ${(m / 10000).toFixed(2)}` : "");
  switch (it.kind) {
    case "base":
      return s.status === "A" ? `${day}Holiday not worked, ${formatMoney(s.dailyRate)}${mult(s.dayMultiplier10000)}`
        : `${day}${s.status === "H" ? "Half day" : "Full day"} at ${formatMoney(s.dailyRate)}${mult(s.dayMultiplier10000)}${s.holiday ? " (holiday)" : ""}`;
    case "ot":
      return `${day}${Number(s.minutes) / 60} h OT at ${formatMoney(s.dailyRate)} ÷ 8 × ${(Number(s.otMultiplier) / 100).toFixed(2)}${mult(s.dayMultiplier10000)}`;
    case "incentive": {
      const jobs = (s.jobs as { code: string; qty: number; amount: number }[]).map((j) => `${j.qty}× ${j.code} ${formatMoney(j.amount)}`).join(", ");
      if (s.specialty) return `${day}${jobs} (your job)`;
      const who = s.eligible as string[];
      return `${day}Pool ${formatMoney(s.pool)} (${jobs}) ÷ ${who.length} (${who.join(", ")})`;
    }
    case "allowance":
      if (s.dailyAllowance !== undefined) return `${day}Daily allowance${s.status === "H" ? " (half day)" : ""}`;
      return `${TYPE[s.type] ?? s.type} — ${s.reason}`;
    case "deduction":
      return `${TYPE[s.type] ?? s.type} — ${s.reason}`;
    case "carried_in":
      return "Balance carried in from an earlier week";
    default:
      return it.kind;
  }
}

