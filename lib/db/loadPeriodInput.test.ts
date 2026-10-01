// Integration: DB → loadPeriodInput → engine → save_draft reproduces fixture F07 (TASK-014).
// Runs in one transaction on the owner connection and rolls back. Skipped when DATABASE_URL_OWNER isn't set.
import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { loadPeriodInput } from "./loadPeriodInput.ts";
import { PG_TYPES } from "./client.ts";
import { computeWeek } from "../payroll/engine.ts";
import { inputHash } from "../payroll/hash.ts";

const url = process.env.DATABASE_URL_OWNER;
const WEEK = "2030-01-07"; // a Monday far from any real data

test("F07 end-to-end from the database", { skip: !url && "DATABASE_URL_OWNER not set" }, async () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {}, types: PG_TYPES });
  try {
    await sql.begin(async (tx) => {
      // Isolate: nobody else is employed in 2030; act as a test owner so carried_in_for() and RLS helpers work
      await tx`update employees set end_date = '2029-12-31' where end_date is null or end_date > '2029-12-31'`;
      // Start from no payroll runs whatever the DB holds (rolled back; lock triggers bypassed only here)
      await tx`set local session_replication_role = replica`;
      await tx`delete from payroll_items`; await tx`delete from payroll_lines`; await tx`delete from payroll_runs`;
      await tx`set local session_replication_role = origin`;
      const [owner] = await tx`insert into users (email, full_name, password_hash, role) values ('it-owner@test.local', 'IT', 'x', 'owner') returning id`;
      await tx`select set_config('app.user_id', ${owner.id}, true)`;

      const mk = async (code: string, rate: number, allowance = 0) => {
        const [e] = await tx`insert into employees (code, full_name, rest_day, hire_date) values (${code}, ${code}, 'sun', '2029-01-01') returning id`;
        await tx`insert into pay_terms (employee_id, effective_from, position, daily_rate, daily_allowance, status) values (${e.id}, '2029-01-01', 'mechanic', ${rate}, ${allowance}, 'approved')`;
        await tx`insert into attendance (employee_id, date, status)
          select ${e.id}, d::date, case when extract(isodow from d) = 7 then 'R' else 'F' end::day_status_t
          from generate_series(${WEEK}::date, ${WEEK}::date + 6, interval '1 day') d`;
        return e.id as string;
      };
      const ids = { ZZM001: await mk("ZZM001", 65000), ZZM002: await mk("ZZM002", 70000), ZZM003: await mk("ZZM003", 60000, 5000) };
      const job = async (code: string, amount: number) => {
        const [j] = await tx`insert into catalog_jobs (code, name) values (${code}, ${code}) returning id`;
        await tx`insert into catalog_amounts (job_id, effective_from, amount) values (${j.id}, '2029-01-01', ${amount})`;
        return j.id as string;
      };
      const tbc = await job("ZTBC", 15000), chain = await job("ZCHN", 10000);
      await tx`insert into job_log (date, job_id, qty) values ('2030-01-08', ${tbc}, 2), ('2030-01-08', ${chain}, 3)`;

      const input = await loadPeriodInput(tx, WEEK);
      assert.deepEqual(input.employees.map((e) => e.code), ["ZZM001", "ZZM002", "ZZM003"]);
      const h1 = inputHash(input);
      assert.equal(inputHash(await loadPeriodInput(tx, WEEK)), h1, "same data, same hash");

      const r = computeWeek(input);
      assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.errors));
      const byCode = Object.fromEntries(r.lines.map((l) => [l.code, { base: l.base, incentive: l.incentive, allowances: l.allowances, net: l.net }]));
      assert.deepEqual(byCode, {
        ZZM001: { base: 390000, incentive: 20000, allowances: 0, net: 410000 },
        ZZM002: { base: 420000, incentive: 20000, allowances: 0, net: 440000 },
        ZZM003: { base: 360000, incentive: 20000, allowances: 30000, net: 410000 }, // PR-062: 6 full days × ₱50
      });

      // The DB's own CHECK constraints accept the engine's lines
      const lines = r.lines.map((l) => ({ employee_id: l.employeeId, basic: l.basic, base: l.base, ot: l.ot, incentive: l.incentive,
        allowances: l.allowances, deductions: l.deductions, carried_in: l.carriedIn, gross: l.gross, net: l.net, carry_out: l.carryOut }));
      const items = r.items.map((i) => ({ employee_id: i.employeeId, date: i.date, kind: i.kind, amount: i.amount, rule_id: i.ruleId, source: i.source }));
      const [{ id }] = await tx`select save_draft(${WEEK}, ${h1}, '{}'::jsonb, ${JSON.stringify(lines)}::text::jsonb, ${JSON.stringify(items)}::text::jsonb) as id`;
      const [{ n }] = await tx`select count(*)::int as n from payroll_lines where run_id = ${id}`;
      assert.equal(n, 3);

      // Any change to the inputs changes the hash (stale-draft detection)
      await tx`update attendance set status = 'H' where employee_id = ${ids.ZZM003} and date = '2030-01-08'`;
      assert.notEqual(inputHash(await loadPeriodInput(tx, WEEK)), h1);

      await tx`update attendance set status = 'F' where employee_id = ${ids.ZZM003} and date = '2030-01-08'`;

      // Inactive job still referenced by a log keeps its amount (history stays payable)
      await tx`update catalog_jobs set active = false where id = ${tbc}`;
      const r2 = computeWeek(await loadPeriodInput(tx, WEEK));
      assert.ok(r2.ok && r2.lines.find((l) => l.code === "ZZM001")!.incentive === 20000);

      // Carry-over from the previous locked week is deducted (PR-061, carried_in_for)
      const prev = "2029-12-31";
      const carryLine = [{ employee_id: ids.ZZM001, basic: 0, base: 0, ot: 0, incentive: 0, allowances: 0, deductions: 5000, carried_in: 0, gross: 0, net: 0, carry_out: 5000 }];
      const [{ pid }] = await tx`select save_draft(${prev}, 'h-prev', '{}'::jsonb, ${JSON.stringify(carryLine)}::text::jsonb, '[]'::jsonb) as pid`;
      await tx`select submit_run(${pid})`;
      await tx`select lock_run(${pid}, 'h-prev')`;
      const withCarry = await loadPeriodInput(tx, WEEK);
      assert.equal(withCarry.carriedIn[ids.ZZM001], 5000);
      const r3 = computeWeek(withCarry);
      assert.ok(r3.ok && r3.lines.find((l) => l.code === "ZZM001")!.net === 405000);

      // Missing attendance in the DB surfaces as an engine error, not silent zero pay (PR-023)
      await tx`delete from attendance where employee_id = ${ids.ZZM002} and date = '2030-01-09'`;
      const r4 = computeWeek(await loadPeriodInput(tx, WEEK));
      assert.ok(!r4.ok && r4.errors.some((e) => e.code === "MISSING_ATTENDANCE" && e.employeeCode === "ZZM002" && e.date === "2030-01-09"));

      // An adjustment for someone not employed that week still loads them (engine never drops money)
      const [old] = await tx`select id from employees where end_date = '2029-12-31' limit 1`;
      assert.ok(old, "fixture needs at least one pre-existing employee (seed data)");
      await tx`insert into adjustments (employee_id, period_start, kind, type, amount, reason) values (${old.id}, ${WEEK}, 'deduction', 'other', 100, 'it')`;
      assert.ok((await loadPeriodInput(tx, WEEK)).employees.some((e) => e.id === old.id));
      throw new Error("ROLLBACK");
    }).catch((e) => { if ((e as Error).message !== "ROLLBACK") throw e; });
  } finally {
    await sql.end();
  }
});
