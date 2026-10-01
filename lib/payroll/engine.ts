// Weekly pay engine — pure, deterministic (PR-070). Rules: docs/02-payroll-rules.md
import type {
  CatalogJob, Centavos, EmployeeInput, IsoDate, JobEntry, PayItem, PayLine, PayrollError, PeriodInput, PeriodResult, Weekday,
} from "./types.ts";

const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Half-up integer division for non-negative values (PR-002). BigInt so products never overflow. */
export function divRound(num: bigint, den: bigint): Centavos {
  return Number((2n * num + den) / (2n * den));
}

export function addDays(date: IsoDate, n: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(date: IsoDate): Weekday {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** Latest entry with `from <= date`, or undefined (effective dating, PR-020 / PR-050). */
export function effective<T extends { from: IsoDate }>(list: T[], date: IsoDate): T | undefined {
  let best: T | undefined;
  for (const x of list) if (x.from <= date && (!best || x.from > best.from)) best = x;
  return best;
}

export function periodDays(periodStart: IsoDate): IsoDate[] {
  if (weekdayOf(periodStart) !== "mon") throw new Error(`periodStart ${periodStart} is not a Monday`);
  return Array.from({ length: 7 }, (_, i) => addDays(periodStart, i));
}

function employed(e: Pick<EmployeeInput, "hireDate" | "endDate">, date: IsoDate): boolean {
  return date >= e.hireDate && (!e.endDate || date <= e.endDate);
}

/**
 * Daily incentive pool split (PR-051–053). `eligible` must be sorted by employee code;
 * the remainder centavos go one each to the first `r` eligible mechanics.
 */
export function splitPool(pool: Centavos, eligible: string[]): Centavos[] {
  const n = eligible.length;
  const share = Math.floor(pool / n);
  const r = pool - share * n;
  return eligible.map((_, i) => share + (i < r ? 1 : 0));
}

/** Day's pool (PR-051): Σ qty × amount in effect that day, excluding specialty entries (PR-055).
 *  Jobs with no amount that day are returned as `unknown`. */
export function dayPool(jobs: JobEntry[], catalog: Map<string, CatalogJob>, date: IsoDate) {
  let pool = 0;
  const lines: { code: string; qty: number; amount: Centavos }[] = [];
  const unknown: string[] = [];
  for (const j of jobs) {
    if (j.date !== date || j.employeeId) continue;
    const amt = effective(catalog.get(j.jobId)?.amounts ?? [], date);
    if (!amt) { unknown.push(j.jobId); continue; }
    pool += j.qty * amt.amount;
    lines.push({ code: catalog.get(j.jobId)!.code, qty: j.qty, amount: amt.amount });
  }
  return { pool, lines, unknown };
}

/** Pool eligibility (PR-052): position `mechanic` ON THAT DAY and status F, sorted by employee code (for PR-053). */
export function eligibleMechanics<E extends Pick<EmployeeInput, "code" | "terms" | "hireDate" | "endDate"> & { id: string }>(
  employees: E[], status: (id: string) => string | undefined, date: IsoDate): E[] {
  return employees
    .filter((e) => employed(e, date) && effective(e.terms, date)?.position === "mechanic" && status(e.id) === "F")
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

export function computeWeek(input: PeriodInput): PeriodResult {
  const days = periodDays(input.periodStart);
  const holidays = new Set(input.holidays);
  const byCode = [...input.employees].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const att = new Map(input.attendance.map((a) => [`${a.employeeId}|${a.date}`, a]));
  const errors: PayrollError[] = [];
  const items: PayItem[] = [];
  const tot = new Map(byCode.map((e) => [e.id, { basic: 0, base: 0, ot: 0, incentive: 0, allowances: 0, deductions: 0 }]));
  const err = (e: PayrollError) => errors.push(e);

  // ── Base pay & OT, per employee per day (PR-022/023, PR-030–032, PR-040/041) ──
  for (const e of byCode) {
    const t = tot.get(e.id)!;
    for (const date of days) {
      const a = att.get(`${e.id}|${date}`);
      const who = { employeeId: e.id, employeeCode: e.code, date };
      if (!employed(e, date)) {
        if (a) err({ code: "NOT_EMPLOYED", ...who });
        continue;
      }
      if (!a) { err({ code: "MISSING_ATTENDANCE", ...who }); continue; }
      const isRestDay = weekdayOf(date) === e.restDay; // usual rest day (PR-021); R may be any day (PR-022)
      if (a.otMinutes > 0 && a.status !== "F") { err({ code: "INVALID_OT", ...who }); continue; }

      const term = effective(e.terms, date);
      const s = effective(input.settings, date);
      if (!term) { err({ code: "NO_PAY_TERMS", ...who }); continue; }
      if (!s) { err({ code: "NO_SETTINGS", date }); continue; }

      const rate = BigInt(term.dailyRate);
      const isHoliday = holidays.has(date);
      // Day multiplier as a fraction mNum / 10000 (rest-day × holiday, PR-030); stored as an integer in provenance
      const mNum = BigInt((isRestDay ? s.restDayWorked : 100) * (isHoliday ? s.holidayWorked : 100));
      const M = 10000n;

      let base = 0;
      if (a.status === "F") {
        base = divRound(rate * mNum, M);
        t.basic += term.dailyRate;
        if (a.otMinutes > 0) {
          const ot = divRound(rate * BigInt(a.otMinutes) * BigInt(s.ot) * mNum, 480n * 100n * M);
          t.ot += ot;
          items.push({ employeeId: e.id, date, kind: "ot", amount: ot, ruleId: "PR-040",
            source: { minutes: a.otMinutes, dailyRate: term.dailyRate, otMultiplier: s.ot, dayMultiplier10000: Number(mNum) } });
        }
      } else if (a.status === "H") {
        base = divRound(rate * mNum, 2n * M);
        t.basic += divRound(rate, 2n);
      } else if (a.status === "A" && isHoliday) {
        base = divRound(rate * BigInt(s.holidayUnworked), 100n);
      }
      // Daily allowance (PR-062): full on F, half on H, none otherwise; never multiplied
      const dailyAllowance = term.dailyAllowance ?? 0;
      const allowance = a.status === "F" ? dailyAllowance : a.status === "H" ? divRound(BigInt(dailyAllowance), 2n) : 0;
      if (allowance > 0) {
        t.allowances += allowance;
        items.push({ employeeId: e.id, date, kind: "allowance", amount: allowance, ruleId: "PR-062",
          source: { status: a.status, dailyAllowance } });
      }
      if (base > 0) {
        t.base += base;
        items.push({ employeeId: e.id, date, kind: "base", amount: base, ruleId: "PR-031",
          source: { status: a.status, dailyRate: term.dailyRate, restDay: isRestDay, holiday: isHoliday,
            dayMultiplier10000: a.status === "A" ? s.holidayUnworked * 100 : Number(mNum) } });
      }
    }
  }

  // ── Incentive pool per day (PR-050–054) ──
  const catalog = new Map(input.catalog.map((j) => [j.id, j]));
  for (const date of days) {
    const { pool, lines: jobs, unknown } = dayPool(input.jobs, catalog, date);
    for (const jobId of unknown) err({ code: "UNKNOWN_JOB", date, jobId });
    if (pool === 0) continue;
    const eligible = eligibleMechanics(byCode, (id) => att.get(`${id}|${date}`)?.status, date);
    if (eligible.length === 0) { err({ code: "NO_ELIGIBLE_MECHANIC", date }); continue; }
    const shares = splitPool(pool, eligible.map((e) => e.code));
    eligible.forEach((e, i) => {
      tot.get(e.id)!.incentive += shares[i];
      items.push({ employeeId: e.id, date, kind: "incentive", amount: shares[i], ruleId: "PR-053",
        source: { pool, eligible: eligible.map((x) => x.code), jobs } });
    });
  }

  // ── Jobs for a specific mechanic (PR-055): qty × amount to that mechanic, whatever their attendance ──
  for (const j of input.jobs) {
    if (!j.employeeId || !days.includes(j.date)) continue;
    const job = catalog.get(j.jobId);
    const amt = effective(job?.amounts ?? [], j.date);
    if (!job || !amt) { err({ code: "UNKNOWN_JOB", date: j.date, jobId: j.jobId }); continue; }
    const e = byCode.find((x) => x.id === j.employeeId);
    if (!e || !employed(e, j.date)) { err({ code: "INVALID_SPECIALIST", date: j.date, jobId: j.jobId, employeeId: j.employeeId }); continue; }
    const amount = j.qty * amt.amount;
    tot.get(e.id)!.incentive += amount;
    items.push({ employeeId: e.id, date: j.date, kind: "incentive", amount, ruleId: "PR-055",
      source: { specialty: true, jobs: [{ code: job.code, qty: j.qty, amount: amt.amount }] } });
  }

  if (errors.length) return { ok: false, errors };

  // ── Adjustments & totals (PR-060/061) ──
  // Loader contract: `employees` includes anyone with an adjustment or carried-in balance. Never drop money silently.
  for (const id of [...input.adjustments.map((a) => a.employeeId), ...Object.keys(input.carriedIn)]) {
    if (!tot.has(id)) throw new Error(`employee ${id} has an adjustment or carried-in balance but is not in input.employees`);
  }
  for (const adj of input.adjustments) {
    const t = tot.get(adj.employeeId)!;
    if (adj.kind === "allowance") t.allowances += adj.amount; else t.deductions += adj.amount;
    items.push({ employeeId: adj.employeeId, date: null, kind: adj.kind, amount: adj.amount, ruleId: "PR-060",
      source: { type: adj.type, reason: adj.reason } });
  }

  const lines: PayLine[] = byCode.map((e) => {
    const t = tot.get(e.id)!;
    const carriedIn = input.carriedIn[e.id] ?? 0;
    if (carriedIn > 0) items.push({ employeeId: e.id, date: null, kind: "carried_in", amount: carriedIn, ruleId: "PR-061", source: {} });
    const gross = t.base + t.ot + t.incentive + t.allowances;
    const raw = gross - t.deductions - carriedIn;
    return { employeeId: e.id, code: e.code, ...t, carriedIn, gross, net: Math.max(0, raw), carryOut: Math.max(0, -raw) };
  });

  return { ok: true, lines, items };
}
