// Integration: report views/queries (US-040, US-041, PR-011, PR-080) against a real DB, rolled back.
// Skipped when DATABASE_URL_OWNER isn't set.
import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { PG_TYPES } from "./client.ts";
import { monthlySummary, thirteenthMonth } from "./reports.ts";
import { thirteenthMonth as engineThirteenth } from "../payroll/thirteenth.ts";

const url = process.env.DATABASE_URL_OWNER;

test("monthly summary + 13th month: locked only, payday attribution, rounding matches engine",
  { skip: !url && "DATABASE_URL_OWNER not set" }, async () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {}, types: PG_TYPES });
  try {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from payroll_items`; await tx`delete from payroll_lines`; await tx`delete from payroll_runs`;
      await tx`set local session_replication_role = origin`;
      const [owner] = await tx`insert into users (email, full_name, password_hash, role) values ('rpt-owner@test.local', 'RPT', 'x', 'owner') returning id`;
      await tx`select set_config('app.user_id', ${owner.id}, true)`;
      const [e] = await tx`insert into employees (code, full_name, rest_day, hire_date) values ('ZZR001', 'Report Test', 'sun', '2029-01-01') returning id`;

      const line = (basic: number, ot: number, incentive: number, deductions: number, carried_in = 0) => {
        const gross = basic + ot + incentive, raw = gross - deductions - carried_in;
        return [{ employee_id: e.id, basic, base: basic, ot, incentive, allowances: 0, deductions, carried_in, gross, net: Math.max(0, raw), carry_out: Math.max(0, -raw) }];
      };
      const run = async (start: string, l: ReturnType<typeof line>, lock: boolean) => {
        const [{ id }] = await tx`select save_draft(${start}, ${"h" + start}, '{}'::jsonb, ${JSON.stringify(l)}::text::jsonb, '[]'::jsonb) as id`;
        if (lock) { await tx`select submit_run(${id})`; await tx`select lock_run(${id}, ${"h" + start})`; }
      };
      // A: paid Sun 2029-12-30 → December 2029. Basic 390006 makes 13th = 32500.5 → half-up 32501 (rounding check)
      await run("2029-12-24", line(390006, 20313, 30000, 0), true);
      // B: week Dec 31 – Jan 6, paid Sun 2030-01-06 → January 2030 / year 2030 (PR-011), with a carried-in balance
      await run("2029-12-31", line(325000, 0, 0, 5000, 1500), true);
      // C: draft — must never appear in reports
      await run("2030-01-07", line(999999, 0, 0, 0), false);

      const dec = await monthlySummary(tx, "2029-12-01");
      assert.deepEqual(dec.map((r) => ({ net: r.net, ot: r.ot, incentive: r.incentive })), [{ net: 440319, ot: 20313, incentive: 30000 }]);
      const jan = await monthlySummary(tx, "2030-01-01");
      assert.deepEqual(jan.map((r) => ({ base: r.base, deductions: r.deductions, carried_in: r.carried_in, net: r.net })),
        [{ base: 325000, deductions: 5000, carried_in: 1500, net: 318500 }], "Dec–Jan week lands in January; draft excluded");
      const j = jan[0];
      assert.equal(j.gross - j.deductions - j.carried_in + j.carry_out, j.net, "summary reconciles");

      const y29 = await thirteenthMonth(tx, 2029), y30 = await thirteenthMonth(tx, 2030);
      assert.equal(y29[0].thirteenth, 32501);
      assert.equal(y29[0].thirteenth, engineThirteenth([{ payday: "2029-12-30", basic: 390006 }], 2029), "view matches engine rounding");
      assert.equal(y30[0].thirteenth, engineThirteenth([{ payday: "2030-01-06", basic: 325000 }], 2030)); // draft run C not counted
      assert.equal(y30[0].total_basic, 325000, "draft basic excluded");
      throw new Error("ROLLBACK");
    }).catch((err) => { if ((err as Error).message !== "ROLLBACK") throw err; });
  } finally {
    await sql.end();
  }
});
