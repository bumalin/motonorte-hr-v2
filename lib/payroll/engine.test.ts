// Runs every golden case in fixtures/payroll/*.json against the engine (source of truth: Owner-approved fixtures).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeWeek } from "./engine.ts";
import { thirteenthMonth } from "./thirteenth.ts";
import type { PeriodInput, DayStatus, Position, Weekday, PayLine } from "./types.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../../fixtures/payroll/${f}`, import.meta.url), "utf8"));
const weekly = load("weekly.json");

type FixtureEmployee = { position: Position; rest_day: Weekday; hire_date: string; rates: { from: string; daily_rate: number; daily_allowance?: number }[] };
type FixtureSettings = { rest_day_worked_multiplier: number; holiday_worked_multiplier: number; holiday_unworked_multiplier: number; ot_multiplier: number };
type FixtureInput = {
  settings?: FixtureSettings;
  employees?: Record<string, FixtureEmployee>;
  catalog?: { code: string; name: string; amounts: { from: string; amount: number }[] }[];
  holidays?: { date: string }[];
  attendance: Record<string, { days: string; ot?: number[] }>;
  jobs?: { date: string; job: string; qty: number; by?: string }[];
  adjustments?: { emp: string; kind: "allowance" | "deduction"; type: string; amount: number; reason: string }[];
  carried_in?: Record<string, number>;
};

/** Expands a fixture's compact input into a PeriodInput (employee id = code, job id = code). */
function toInput(c: { input: FixtureInput }): PeriodInput {
  const d = weekly.defaults, i = c.input;
  const s = i.settings ?? d.settings;
  const emps: Record<string, FixtureEmployee> = { ...d.employees, ...(i.employees ?? {}) };
  const periodStart: string = d.period_start;
  const day = (n: number) => { const x = new Date(`${periodStart}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

  const attendance: PeriodInput["attendance"] = [];
  for (const [code, a] of Object.entries(i.attendance)) {
    [...a.days].forEach((ch, n) => {
      if (ch === "-" || ch === ".") return; // not employed / missing entry
      attendance.push({ employeeId: code, date: day(n), status: ch as DayStatus, otMinutes: a.ot?.[n] ?? 0 });
    });
  }
  return {
    periodStart,
    settings: [{ from: "0000-01-01", restDayWorked: Math.round(s.rest_day_worked_multiplier * 100), holidayWorked: Math.round(s.holiday_worked_multiplier * 100),
      holidayUnworked: Math.round(s.holiday_unworked_multiplier * 100), ot: Math.round(s.ot_multiplier * 100) }],
    holidays: (i.holidays ?? []).map((h) => h.date),
    employees: Object.keys(i.attendance).map((code) => {
      const e = emps[code];
      return { id: code, code, restDay: e.rest_day, hireDate: e.hire_date,
        terms: e.rates.map((r) => ({ from: r.from, position: e.position, dailyRate: r.daily_rate, dailyAllowance: r.daily_allowance ?? 0 })) };
    }),
    catalog: ((i.catalog ?? d.catalog) as NonNullable<FixtureInput["catalog"]>).map((j) => ({ id: j.code, code: j.code, name: j.name, amounts: j.amounts })),
    attendance,
    jobs: (i.jobs ?? []).map((j) => ({ date: j.date, jobId: j.job, qty: j.qty, ...(j.by ? { employeeId: j.by } : {}) })),
    adjustments: (i.adjustments ?? []).map((a) => ({ employeeId: a.emp, kind: a.kind, type: a.type, amount: a.amount, reason: a.reason })),
    carriedIn: i.carried_in ?? {},
  };
}

const toFixtureShape = (l: PayLine) => ({ basic: l.basic, base: l.base, ot: l.ot, incentive: l.incentive, allowances: l.allowances,
  deductions: l.deductions, carried_in: l.carriedIn, gross: l.gross, net: l.net, carry_out: l.carryOut });

for (const c of weekly.cases) {
  test(`${c.id} ${c.name}`, () => {
    const r = computeWeek(toInput(c));
    if (c.expected.error) {
      assert.equal(r.ok, false, "expected an error");
      if (r.ok) return;
      const { code, date, emp } = c.expected.error;
      assert.deepEqual(r.errors.map((e) => ({ code: e.code, date: e.date, ...(e.employeeCode ? { emp: e.employeeCode } : {}) })),
        [{ code, date, ...(emp ? { emp } : {}) }]);
      return;
    }
    assert.equal(r.ok, true, r.ok ? "" : JSON.stringify(r.errors));
    if (!r.ok) return;
    assert.deepEqual(Object.fromEntries(r.lines.map((l) => [l.code, toFixtureShape(l)])), c.expected);

    // Provenance must add up to every line figure (drill-down integrity, US-031)
    for (const l of r.lines) {
      const sum = (k: string): number => r.items.filter((it) => it.employeeId === l.employeeId && it.kind === k).reduce((s, it) => s + it.amount, 0);
      assert.deepEqual(
        { base: sum("base"), ot: sum("ot"), incentive: sum("incentive"), allowances: sum("allowance"), deductions: sum("deduction"), carriedIn: sum("carried_in") },
        { base: l.base, ot: l.ot, incentive: l.incentive, allowances: l.allowances, deductions: l.deductions, carriedIn: l.carriedIn },
        `items for ${l.code} don't add up`);
    }
  });
}

for (const c of load("thirteenth-month.json").cases) {
  test(`${c.id} ${c.name}`, () => {
    assert.equal(thirteenthMonth(c.input.runs, c.input.year), c.expected.thirteenth);
  });
}

test("deterministic: same input, same output", () => {
  const c = weekly.cases.find((x: { id: string }) => x.id === "F12");
  assert.deepEqual(computeWeek(toInput(c)), computeWeek(toInput(c)));
});

test("PR-062 allowance is never multiplied; half day rounds half-up", () => {
  // Holiday worked ×2.00 on Mon, usual rest day (Sun) worked ×1.30, odd allowance on a half day
  const input = toInput(weekly.cases.find((x: { id: string }) => x.id === "F24"));
  input.settings[0] = { ...input.settings[0], restDayWorked: 130, holidayWorked: 200 };
  input.holidays = [input.periodStart];
  input.employees[0].terms[0].dailyAllowance = 5001;
  input.attendance = input.attendance.map((a, n) => ({ ...a, status: n === 1 ? "H" : "F", otMinutes: 0 }));
  const r = computeWeek(input);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.errors));
  assert.equal(r.lines[0].allowances, 6 * 5001 + 2501);
});

test("PR-055 specialty job for someone not employed that day is an error, never dropped", () => {
  const input = toInput(weekly.cases.find((x: { id: string }) => x.id === "F27"));
  input.jobs.push({ date: "2026-10-06", jobId: "RSS1", qty: 1, employeeId: "S003" }); // S003 not in this week's input
  const r = computeWeek(input);
  assert.ok(!r.ok && r.errors.some((e) => e.code === "INVALID_SPECIALIST"));
});

test("adjustment for an employee missing from input throws instead of dropping money", () => {
  const c = weekly.cases.find((x: { id: string }) => x.id === "F01");
  const input = toInput(c);
  input.adjustments.push({ employeeId: "GHOST", kind: "deduction", type: "other", amount: 100, reason: "x" });
  assert.throws(() => computeWeek(input), /not in input.employees/);
});
