// Hand-computed rule tests for paths the Owner-approved fixtures don't reach (review TASK-001..004, finding 2).
// Values are worked out from the PR formulas in docs/02-payroll-rules.md, not from the engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWeek } from "./engine.ts";
import type { EmployeeInput, PeriodInput, PayLine } from "./types.ts";

const WEEK = "2026-10-05"; // Mon; Sun = 2026-10-11
const day = (n: number) => `2026-10-${String(5 + n).padStart(2, "0")}`;

function input(p: Partial<PeriodInput> & { employees: EmployeeInput[]; days: Record<string, string>; ot?: Record<string, number[]> }): PeriodInput {
  return {
    periodStart: WEEK,
    settings: p.settings ?? [{ from: "2000-01-01", restDayWorked: 100, holidayWorked: 100, holidayUnworked: 0, ot: 125 }],
    holidays: p.holidays ?? [],
    employees: p.employees,
    catalog: [{ id: "J", code: "J", name: "Job", amounts: [{ from: "2000-01-01", amount: 10000 }] }],
    attendance: Object.entries(p.days).flatMap(([id, s]) =>
      [...s].map((st, n) => ({ employeeId: id, date: day(n), status: st as "F" | "H" | "A" | "R", otMinutes: p.ot?.[id]?.[n] ?? 0 }))),
    jobs: p.jobs ?? [],
    adjustments: [],
    carriedIn: {},
  };
}
const emp = (code: string, terms: EmployeeInput["terms"]): EmployeeInput => ({ id: code, code, restDay: "sun", hireDate: "2025-01-01", terms });
function lines(i: PeriodInput): Record<string, PayLine> {
  const r = computeWeek(i);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.errors));
  return Object.fromEntries(r.lines.map((l) => [l.code, l]));
}

test("PR-020/052: pool eligibility uses the position on THAT day (staff → mechanic Wednesday)", () => {
  const l = lines(input({
    employees: [
      emp("E001", [{ from: "2025-01-01", position: "staff", dailyRate: 50000 }, { from: "2026-10-07", position: "mechanic", dailyRate: 60000 }]),
      emp("M001", [{ from: "2025-01-01", position: "mechanic", dailyRate: 65000 }]),
    ],
    days: { E001: "FFFFFFR", M001: "FFFFFFR" },
    jobs: [{ date: day(1), jobId: "J", qty: 1 }, { date: day(3), jobId: "J", qty: 1 }], // Tue ₱100, Thu ₱100
  }));
  // Tue: only M001 is a mechanic → ₱100. Thu: both → ₱50 each.
  assert.equal(l.E001.incentive, 5000);
  assert.equal(l.M001.incentive, 15000);
  assert.equal(l.E001.base, 2 * 50000 + 4 * 60000);
});

test("PR-020/052: mechanic → staff mid-week loses eligibility from that day", () => {
  const l = lines(input({
    employees: [
      emp("E001", [{ from: "2025-01-01", position: "mechanic", dailyRate: 60000 }, { from: "2026-10-07", position: "staff", dailyRate: 60000 }]),
      emp("M001", [{ from: "2025-01-01", position: "mechanic", dailyRate: 65000 }]),
    ],
    days: { E001: "FFFFFFR", M001: "FFFFFFR" },
    jobs: [{ date: day(1), jobId: "J", qty: 1 }, { date: day(3), jobId: "J", qty: 1 }],
  }));
  assert.equal(l.E001.incentive, 5000);  // Tue share only
  assert.equal(l.M001.incentive, 15000); // Tue ₱50 + Thu ₱100
});

test("PR-030/031/040: rest day that is also a holiday multiplies both; F, H and OT", () => {
  const settings = [{ from: "2000-01-01", restDayWorked: 130, holidayWorked: 200, holidayUnworked: 100, ot: 125 }];
  const holidays = [day(6)]; // Sunday = rest day AND holiday
  const full = lines(input({ settings, holidays, employees: [emp("S001", [{ from: "2025-01-01", position: "staff", dailyRate: 55000 }])],
    days: { S001: "AAAAAAF" }, ot: { S001: [0, 0, 0, 0, 0, 0, 60] } })).S001;
  // base = 55000 × 1.30 × 2.00 = 143000
  assert.equal(full.base, 143000);
  // OT = 55000 × 60 × 1.25 × 2.60 ÷ 480 = 22343.75 → 22344
  assert.equal(full.ot, 22344);
  assert.equal(full.basic, 55000); // basic never includes multipliers (PR-032)

  const half = lines(input({ settings, holidays, employees: [emp("S001", [{ from: "2025-01-01", position: "staff", dailyRate: 55000 }])],
    days: { S001: "AAAAAAH" } })).S001;
  // H = 55000 × 0.5 × 2.60 = 71500
  assert.equal(half.base, 71500);
  assert.equal(half.basic, 27500);
});

test("PR-031/032/002: half day with an odd rate rounds half-up", () => {
  const l = lines(input({ employees: [emp("S001", [{ from: "2025-01-01", position: "staff", dailyRate: 55001 }])], days: { S001: "HAAAAAR" } })).S001;
  // 55001 ÷ 2 = 27500.5 → 27501
  assert.equal(l.base, 27501);
  assert.equal(l.basic, 27501);
});

test("PR-031: unworked holiday uses holiday_unworked multiplier; rest-day R never pays", () => {
  const settings = [{ from: "2000-01-01", restDayWorked: 130, holidayWorked: 200, holidayUnworked: 100, ot: 125 }];
  const l = lines(input({ settings, holidays: [day(2), day(6)], employees: [emp("S001", [{ from: "2025-01-01", position: "staff", dailyRate: 55000 }])],
    days: { S001: "FFAFFFR" } })).S001;
  // 5 × 55000 + unworked holiday Wed 55000 × 1.00; Sunday holiday is R (rest day not worked) → 0
  assert.equal(l.base, 330000);
  assert.equal(l.basic, 275000);
});

test("settings are effective-dated per day", () => {
  const l = lines(input({
    settings: [{ from: "2000-01-01", restDayWorked: 100, holidayWorked: 100, holidayUnworked: 0, ot: 125 },
               { from: "2026-10-08", restDayWorked: 100, holidayWorked: 100, holidayUnworked: 0, ot: 150 }],
    employees: [emp("S001", [{ from: "2025-01-01", position: "staff", dailyRate: 48000 }])],
    days: { S001: "FFFFFFR" }, ot: { S001: [60, 0, 0, 60, 0, 0, 0] },
  })).S001;
  // Mon: 48000 × 60 × 1.25 ÷ 480 = 7500; Thu: 48000 × 60 × 1.50 ÷ 480 = 9000
  assert.equal(l.ot, 16500);
});
