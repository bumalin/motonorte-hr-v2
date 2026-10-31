// The weekly cycle end to end (UX F-1..F-5), two roles in two browser contexts, one ordered story.
// Week 2026-10-05 is seeded to mirror fixture F07; the staff edits below and the expected nets are worked out
// by hand in docs/07-test-report.md §3.
// Tests run in file order on one worker. State lives in the e2e DB (run and employee ids are looked up there),
// so a failing step doesn't hide the steps after it.
import { test, expect, type Browser, type Page } from "@playwright/test";
import { login, e2eSql } from "./helpers.ts";

const WEEK = "2026-10-05";
const S002_ID = "00000000-0000-0000-0000-00000000a002";

// Hand-calculated nets in centavos (report §3). First draft, then after the Owner's send-back (−₱100 deduction on M003).
const FIRST_NET = { S001: 330000, S002: 280000, T001: 450000, M001: 436980, M002: 446667, M003: 356666 };
const FINAL_NET = { ...FIRST_NET, M003: 346666 };
const peso = (c: number) => `₱${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

let staff: Page, owner: Page;

async function open(browser: Browser, role: "owner" | "staff") {
  const page = await (await browser.newContext()).newPage();
  await login(page, role);
  return page;
}

test.beforeAll(async ({ browser }) => {
  staff = await open(browser, "staff");
  owner = await open(browser, "owner");
});
test.afterAll(async () => {
  await staff?.context().close();
  await owner?.context().close();
});

/** Net column of each line on the run page, keyed by employee code. */
async function netsOnPage(page: Page) {
  const out: Record<string, string> = {};
  for (const row of await page.locator("tbody tr").all()) {
    const code = (await row.locator("th .font-mono").textContent())!.trim();
    out[code] = (await row.locator("td").nth(9).textContent())!.trim();
  }
  return out;
}
async function netsInDb(id: string) {
  const sql = e2eSql();
  try {
    const rows = await sql<{ code: string; net: string }[]>`
      select e.code, l.net::text from payroll_lines l join employees e on e.id = l.employee_id where l.run_id = ${id}`;
    return Object.fromEntries(rows.map((r) => [r.code, Number(r.net)]));
  } finally { await sql.end(); }
}
async function runOf(week: string): Promise<string> {
  const sql = e2eSql();
  try { return (await sql<{ id: string }[]>`select id from payroll_runs where period_start = ${week}`)[0]?.id; } finally { await sql.end(); }
}
async function employeeId(code: string): Promise<string> {
  const sql = e2eSql();
  try { return (await sql<{ id: string }[]>`select id from employees where code = ${code}`)[0]?.id; } finally { await sql.end(); }
}
/** The Owner's "Approve & lock" (E2E-RUN-06) must have locked the week through the UI — no DB shortcut (TASK-026 fixed). */
async function ensureLocked(week: string) {
  expect(await runStatus(await runOf(week)), `week ${week} should be locked by the UI`).toBe("locked");
}
async function runStatus(id: string) {
  const sql = e2eSql();
  try { return (await sql<{ status: string }[]>`select status from payroll_runs where id = ${id}`)[0]?.status; } finally { await sql.end(); }
}
/** Select a grid cell's status and wait for the per-cell save tick. */
async function setCell(page: Page, code: string, date: string, status: string) {
  const sel = page.getByLabel(`${code} ${date} status`);
  await sel.selectOption(status);
  await expect(page.locator("td", { has: sel }).getByText("✓")).toBeVisible();
}

test("E2E-EMP-01 staff creates an employee; invalid input shows a field error and saves nothing (US-001)", async () => {
  await staff.goto("/employees/new");
  await expect(staff.getByLabel(/Employee code/)).toHaveValue("M004");
  await staff.getByLabel(/Full name/).fill("Gil Torres (e2e)");
  await staff.getByLabel(/Hire date/).fill("2026-10-12");
  await staff.getByLabel(/Daily rate/).fill("abc");
  await staff.getByLabel("TIN").fill("123-456-789-000");
  await staff.getByLabel("Account no.").fill("1234567890");
  await staff.getByRole("button", { name: "Create employee" }).click();
  await expect(staff.getByText("Enter a daily rate like 650 or 650.00")).toBeVisible();
  await expect(staff.getByLabel(/Daily rate/)).toHaveAttribute("aria-invalid", "true");
  const sql = e2eSql();
  try { expect((await sql`select 1 from employees where code = 'M004'`).length).toBe(0); } finally { await sql.end(); }

  await staff.getByLabel(/Daily rate/).fill("680");
  await staff.getByRole("button", { name: "Create employee" }).click();
  await expect(staff).toHaveURL(/\/employees\/[0-9a-f-]{36}$/);
  const newEmployeeId = staff.url().split("/").pop()!;
  await expect(staff.getByRole("heading", { level: 1 })).toContainText("M004 · Gil Torres (e2e)");

  // Staff's rate is only a proposal; staff has no Approve button (US-002, PRD §4)
  await staff.goto(`/employees/${newEmployeeId}?tab=terms`);
  await expect(staff.locator("tbody")).toContainText("proposed");
  await expect(staff.getByRole("button", { name: "Approve" })).toHaveCount(0);

  await staff.goto("/employees");
  await expect(staff.locator("tbody")).toContainText("M004");
});

test("E2E-EMP-02 owner approves the proposed rate from the dashboard (US-002)", async () => {
  const newEmployeeId = await employeeId("M004");
  await owner.goto("/");
  const item = owner.locator("#approvals + ul li", { hasText: "M004" });
  await expect(item).toContainText("₱680.00/day + ₱0.00 allowance from Oct 12, 2026");
  await expect(item).toContainText("proposed by E2E Staff");
  await item.getByRole("button", { name: "Approve" }).click();
  await expect(item).toHaveCount(0);
  await owner.goto(`/employees/${newEmployeeId}?tab=terms`);
  await expect(owner.locator("tbody")).toContainText("approved");
  await expect(owner.locator("tbody")).toContainText("Proposed by E2E Staff · Approved by E2E Owner");
});

test("E2E-WEEK-01 owner fills attendance: OT, half day, and clears one cell (US-021)", async () => {
  await owner.goto(`/week/${WEEK}`);
  await expect(owner.getByRole("heading", { name: "Oct 5 – 11, 2026" })).toBeVisible();
  await setCell(owner, "M003", "2026-10-07", "H");
  const ot = owner.getByLabel("M001 2026-10-05 overtime hours");
  await ot.fill("2");
  await ot.blur();
  await expect(owner.locator("td", { has: ot }).getByText("✓")).toBeVisible();
  await setCell(owner, "S001", "2026-10-08", ""); // leave a hole for the MISSING_ATTENDANCE check
  await expect(owner.getByRole("button", { name: "Fill empty cells (1)" })).toBeVisible();
  // Footer: full-day mechanics per day (Wed drops to 2 because M003 is half day)
  await expect(owner.locator("tfoot tr")).toHaveText(/Full-day mechanics\s*3\s*3\s*2\s*3\s*3\s*3\s*0/);
});

test("E2E-WEEK-02 staff logs a job and the pool summary splits it with the remainder rule (US-020)", async () => {
  await staff.goto(`/week/${WEEK}?tab=jobs&day=2026-10-06`);
  await expect(staff.getByText("Pool ₱600.00 ÷ 3 full-day mechanics (M001, M002, M003) = ₱200.00 each")).toBeVisible();

  await staff.goto(`/week/${WEEK}?tab=jobs&day=2026-10-08`);
  await staff.locator("select[name=job_id]").selectOption({ label: "CARB · Carburetor Cleaning (sample) (₱200.00)" });
  await staff.getByLabel("WO ref").fill("WO-E2E-1");
  await staff.getByLabel("Plate").fill("E2E 0001");
  await staff.getByRole("button", { name: "Add", exact: true }).click();
  await expect(staff.locator("tbody")).toContainText("WO-E2E-1");
  await expect(staff.getByText("Pool ₱200.00 ÷ 3 full-day mechanics: M001 ₱66.67, M002 ₱66.67, M003 ₱66.66 (extra centavo to lowest code)")).toBeVisible();
  await expect(staff.getByRole("link", { name: /Thu Oct 8 · ₱200.00/ })).toBeVisible();
});

test("E2E-WEEK-03 staff adds a cash-advance deduction (US-033)", async () => {
  await staff.goto(`/week/${WEEK}?tab=adjustments`);
  await staff.getByLabel("Employee").selectOption({ label: "S002 · Ben Cruz (sample)" });
  await staff.getByLabel("Type").selectOption("cash_advance");
  await staff.getByLabel("Amount (₱)").fill("500");
  await staff.getByLabel("Reason").fill("Cash advance Oct 7");
  await staff.getByRole("button", { name: "Add", exact: true }).click();
  await expect(staff.locator("tbody tr", { hasText: "S002" })).toContainText("−₱500.00");
});

test("E2E-RUN-01 generate lists missing attendance with a Fix link; fixing it produces the hand-calculated draft (US-030, PR-023)", async () => {
  await staff.goto(`/week/${WEEK}`);
  await staff.getByRole("button", { name: "Generate payroll draft" }).click();
  const errors = staff.getByRole("alert").filter({ hasText: "Payroll can't be generated yet" });
  await expect(errors).toContainText("Missing attendance: S001 on Thu Oct 8");
  await errors.getByRole("link", { name: "Fix →" }).click();
  await expect(staff).toHaveURL(/focus=/);
  await expect(staff.getByLabel("S001 2026-10-08 status")).toBeDisabled();
  await owner.goto(`/week/${WEEK}`);

  await owner.getByRole("button", { name: "Fill empty cells (1)" }).click();
  await staff.reload();
  await expect(staff.getByLabel("S001 2026-10-08 status")).toHaveValue("F");

  await staff.getByRole("button", { name: "Generate payroll draft" }).click();
  await expect(staff).toHaveURL(/\/payroll\/[0-9a-f-]{36}$/);
  const runId = staff.url().split("/").pop()!;

  expect(await netsInDb(runId)).toEqual(FIRST_NET); // to the centavo
  expect(await netsOnPage(staff)).toEqual(Object.fromEntries(Object.entries(FIRST_NET).map(([k, v]) => [k, peso(v)])));
  await expect(staff.locator("tfoot")).toContainText(peso(total(FIRST_NET)));
});

test("E2E-RUN-02 drill-down shows source entries and rule IDs (US-031)", async () => {
  await staff.goto(`/payroll/${await runOf(WEEK)}`);
  await staff.getByRole("button", { name: "Incentive for M001: ₱266.67, show details" }).click();
  const dlg = staff.getByRole("dialog", { name: "Incentive for M001" });
  // Same-day jobs are listed in log order (created_at, id); the two seeded rows share created_at, so either order is valid
  await expect(dlg).toContainText(/Tue Oct 6 — Pool ₱600\.00 \((2× TBC ₱150\.00, 3× CHAIN ₱100\.00|3× CHAIN ₱100\.00, 2× TBC ₱150\.00)\) ÷ 3 \(M001, M002, M003\)/);
  await expect(dlg).toContainText("Thu Oct 8 — Pool ₱200.00 (1× CARB ₱200.00) ÷ 3 (M001, M002, M003)");
  await expect(dlg).toContainText("PR-053");
  await dlg.getByRole("button", { name: "Close" }).click();

  await staff.getByRole("button", { name: "OT for M001: ₱203.13, show details" }).click();
  await expect(staff.getByRole("dialog", { name: "OT for M001" })).toContainText("Mon Oct 5 — 2 h OT at ₱650.00 ÷ 8 × 1.25");
  await staff.getByRole("dialog", { name: "OT for M001" }).getByRole("button", { name: "Close" }).click();
});

test("E2E-RUN-03 staff submits; staff gets no Approve or Send back (US-032)", async () => {
  const runId = await runOf(WEEK);
  await staff.goto(`/payroll/${runId}`);
  await staff.getByRole("button", { name: "Submit for approval" }).click();
  await staff.getByRole("dialog").getByRole("button", { name: "Submit", exact: true }).click();
  await expect(staff.getByText("Waiting for the Owner's approval.")).toBeVisible();
  expect(await runStatus(runId)).toBe("submitted");
  await expect(staff.getByRole("button", { name: "Approve & lock" })).toHaveCount(0);
  await expect(staff.getByRole("button", { name: "Send back" })).toHaveCount(0);

  // Submitted week is read-only for staff too
  await staff.goto(`/week/${WEEK}`);
  await expect(staff.getByText("Submitted for approval — this week is read-only.")).toBeVisible();
  await expect(staff.getByLabel("M001 2026-10-05 status")).toBeDisabled();
});

test("E2E-RUN-04 owner sends the run back with a note", async () => {
  const runId = await runOf(WEEK);
  await owner.goto("/");
  const item = owner.locator("#approvals + ul li", { hasText: "Payroll Oct 5 – 11, 2026" });
  await expect(item).toContainText(`6 employees · Net ${peso(total(FIRST_NET))}`);
  await item.getByRole("link", { name: "Review" }).click();
  await expect(owner).toHaveURL(new RegExp(`/payroll/${runId}$`));
  await owner.getByRole("button", { name: "Send back" }).click();
  const dlg = owner.getByRole("dialog");
  await dlg.getByLabel("Note").fill("Please deduct M003's ₱100 tool breakage.");
  await dlg.getByRole("button", { name: "Send back" }).click();
  await expect(owner.getByText("Sent back by the Owner:")).toBeVisible();
  expect(await runStatus(runId)).toBe("draft");
});

test("E2E-RUN-05 staff sees the note, fixes, sees the stale banner, regenerates and resubmits", async () => {
  let runId = await runOf(WEEK);
  await staff.goto(`/payroll/${runId}`);
  await expect(staff.getByText("Please deduct M003's ₱100 tool breakage.")).toBeVisible();

  await staff.goto(`/week/${WEEK}?tab=adjustments`);
  await staff.getByLabel("Employee").selectOption({ label: "M003 · Fe Villanueva (sample)" });
  await staff.getByLabel("Type").selectOption("other");
  await staff.getByLabel("Amount (₱)").fill("100");
  await staff.getByLabel("Reason").fill("Tool breakage Wed (per Owner note)");
  await staff.getByRole("button", { name: "Add", exact: true }).click();
  await expect(staff.locator("tbody tr", { hasText: "Tool breakage Wed" })).toContainText("−₱100.00");

  await staff.goto(`/payroll/${runId}`);
  await expect(staff.getByText("changed since this draft was generated")).toBeVisible();
  await expect(staff.getByRole("button", { name: "Submit for approval" })).toHaveCount(0);

  await staff.getByRole("link", { name: "Regenerate it" }).click();
  await staff.getByRole("button", { name: "Generate payroll draft" }).click();
  await expect(staff).toHaveURL(/\/payroll\/[0-9a-f-]{36}$/);
  runId = staff.url().split("/").pop()!;
  expect(await netsInDb(runId)).toEqual(FINAL_NET);
  await staff.getByRole("button", { name: "Submit for approval" }).click();
  await staff.getByRole("dialog").getByRole("button", { name: "Submit", exact: true }).click();
  await expect(staff.getByText("Waiting for the Owner's approval.")).toBeVisible();
});

test("E2E-SEC-01 a staff user's direct call to the owner-only lock action is refused (US-032, US-061)", async () => {
  const runId = await runOf(WEEK);
  // Capture the real "Approve & lock" Server Action request from the owner's page without letting it run
  await owner.goto(`/payroll/${runId}`);
  let captured: { headers: Record<string, string>; body: string } | undefined;
  await owner.route(/\/payroll\//, async (route) => {
    const r = route.request();
    if (r.method() === "POST" && r.headers()["next-action"]) {
      captured = { headers: r.headers(), body: r.postData() ?? "" };
      await route.abort();
    } else await route.continue();
  });
  await owner.getByRole("button", { name: "Approve & lock" }).click();
  await owner.getByRole("dialog").getByRole("button", { name: "Approve & lock" }).click();
  await expect.poll(() => captured).toBeTruthy();
  await owner.unroute(/\/payroll\//);

  // Replay it from the staff user's browser session
  await staff.goto(`/payroll/${runId}`);
  const h = captured!.headers;
  const res = await staff.evaluate(async ({ headers, body }) => {
    const r = await fetch(location.href, { method: "POST", headers, body });
    return { status: r.status, text: await r.text() };
  }, { headers: { "next-action": h["next-action"], "content-type": h["content-type"], accept: "text/x-component",
    "next-router-state-tree": h["next-router-state-tree"] ?? "" }, body: captured!.body });
  expect(res.text).toContain("Only the Owner can approve and lock payroll.");
  expect(await runStatus(runId)).toBe("submitted");
});

test("E2E-RUN-06 owner approves and locks; the dialog restates headcount and net (US-032)", async () => {
  const runId = await runOf(WEEK);
  await owner.goto(`/payroll/${runId}`);
  await owner.getByRole("button", { name: "Approve & lock" }).click();
  const dlg = owner.getByRole("dialog");
  await expect(dlg).toContainText(`6 employees · Net ${peso(total(FINAL_NET))}.`);
  await expect(dlg).toContainText("Only the latest locked week can be reopened later");
  await dlg.getByRole("button", { name: "Approve & lock" }).click();
  await expect(owner.getByRole("link", { name: "Payslips" })).toBeVisible();
  await expect(owner.getByText(/Locked .* by E2E Owner/)).toBeVisible();
  expect(await runStatus(runId)).toBe("locked");
  expect(await netsOnPage(owner)).toEqual(Object.fromEntries(Object.entries(FINAL_NET).map(([k, v]) => [k, peso(v)])));
});

test.describe("after the week is locked", () => {
test.beforeEach(() => ensureLocked(WEEK));

test("E2E-LOCK-01 the locked week is read-only (US-023)", async () => {
  await staff.goto(`/week/${WEEK}`);
  await expect(staff.getByText("This week is locked. Changes go in as adjustments on a later week.")).toBeVisible();
  await expect(staff.getByRole("button", { name: "Generate payroll draft" })).toHaveCount(0);
  await expect(staff.getByRole("button", { name: /Fill empty cells/ })).toHaveCount(0);
  for (const s of await staff.locator("tbody select").all()) await expect(s).toBeDisabled();
  await staff.goto(`/week/${WEEK}?tab=jobs&day=2026-10-06`);
  await expect(staff.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  await expect(staff.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await staff.goto(`/week/${WEEK}?tab=adjustments`);
  await expect(staff.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  await expect(staff.getByRole("button", { name: "Remove" })).toHaveCount(0);
});

test("E2E-SLIP-01 payslips render one per employee with itemized incentives (US-034)", async () => {
  const runId = await runOf(WEEK);
  await staff.goto(`/payroll/${runId}/payslips`);
  const slips = staff.locator("article.payslip");
  await expect(slips).toHaveCount(6);
  const m001 = slips.filter({ hasText: "Dan Garcia" });
  await expect(m001).toContainText("Payday Oct 11, 2026");
  await expect(m001).toContainText("Thu Oct 8 — Pool ₱200.00 (1× CARB ₱200.00) ÷ 3 (M001, M002, M003)");
  await expect(m001).toContainText("Mon Oct 5 — 2 h OT");
  await expect(m001).toContainText("Rest day: Sun Oct 11");
  await expect(m001.locator("p.text-2xl")).toHaveText(peso(FINAL_NET.M001));
  const s002 = slips.filter({ hasText: "Ben Cruz" });
  await expect(s002).toContainText("Cash advance — Cash advance Oct 7");
  await expect(s002.locator("p.text-2xl")).toHaveText(peso(FINAL_NET.S002));
  await expect(staff.getByRole("button", { name: /Print/ })).toBeVisible();
});

test("E2E-REP-01 reports show the locked run: monthly summary and 13th month (US-040, US-041)", async () => {
  await staff.goto("/reports?month=2026-10&year=2026");
  const monthly = staff.locator("section").first();
  await expect(monthly.locator("tfoot")).toContainText(peso(total(FINAL_NET)));
  await expect(monthly.locator("tbody tr", { hasText: "M003" })).toContainText("₱100.00");
  // 13th month: M003 basic = 5 × 600 + 300 = ₱3,300.00 → ÷ 12 = ₱275.00 (incentives, OT, allowances excluded)
  const t13 = staff.locator("section").nth(1).locator("tbody tr", { hasText: "M003" });
  await expect(t13).toContainText("₱3,300.00");
  await expect(t13).toContainText("₱275.00");
  const csv = await staff.evaluate(async () => {
    const r = await fetch("/reports/export?kind=monthly&month=2026-10");
    return { status: r.status, text: await r.text() };
  });
  expect(csv.status).toBe(200);
  expect(csv.text).toContain("M003");
});

test("E2E-DASH-01 dashboard shows the locked week (US-050)", async () => {
  await owner.goto("/");
  await expect(owner.getByLabel("Week", { exact: true })).toHaveValue(WEEK);
  const tile = (label: string) => owner.locator("div.rounded-md", { has: owner.getByText(label, { exact: true }) });
  await expect(tile("Net payroll")).toContainText("₱22,903");
  await expect(tile("Incentives paid")).toContainText("₱800");
  await expect(tile("Incentive jobs logged")).toContainText("6");
  await expect(owner.locator("section", { hasText: "Incentives per mechanic" }).locator("tbody tr", { hasText: "M001" })).toContainText("₱266.67");
  await expect(owner.locator("section", { hasText: "Top incentive jobs" })).toContainText("TBC");
  await expect(owner.locator("#approvals")).toHaveCount(0); // nothing left to approve
});

test("E2E-AUD-01 audit log shows who did what (US-060)", async () => {
  await owner.goto("/audit?table=payroll_runs");
  const body = owner.locator("tbody").first();
  await expect(body).toContainText("UPDATE payroll runs");
  await expect(body).toContainText("E2E Owner");
  await expect(body).toContainText("E2E Staff");
  await expect(body).toContainText("locked");
  await expect(body).toContainText("Please deduct M003's ₱100 tool breakage.");

  await owner.goto("/audit?table=employees"); // US-001: creating an employee is audited
  await expect(owner.locator("tbody tr", { hasText: "INSERT employees" }).filter({ hasText: "M004" }).first()).toContainText("E2E Staff");

  await staff.goto("/audit?table=attendance"); // staff can view too (PRD §4)
  await expect(staff.locator("tbody tr", { hasText: "M003" }).filter({ hasText: "2026-10-07" }).first()).toContainText("UPDATE attendance");
  await staff.goto("/audit?table=adjustments");
  await expect(staff.locator("tbody").first()).toContainText("INSERT adjustments");
});

test("E2E-SEC-02 staff cannot reach owner-only controls (catalog, settings, users)", async () => {
  await staff.goto("/catalog");
  await expect(staff.getByText("Only the Owner can change this list.")).toBeVisible();
  await expect(staff.getByRole("button", { name: /Add job|Change amount|Deactivate|Activate/ })).toHaveCount(0);
  await staff.goto("/settings");
  await expect(staff.getByRole("heading", { name: "Users" })).toHaveCount(0);
  await expect(staff.locator("main input:not([type=hidden])")).toHaveCount(0);
  await expect(staff.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await staff.goto("/");
  await expect(staff.locator("#approvals")).toHaveCount(0);
});

test("E2E-EMP-03 deactivated employee is excluded from the next run; past run keeps them (US-003)", async () => {
  const runId = await runOf(WEEK);
  await staff.goto(`/employees/${S002_ID}`);
  await staff.getByRole("button", { name: "Deactivate employee" }).click();
  const dlg = staff.getByRole("dialog");
  await dlg.getByLabel("Last day of employment").fill("2026-10-13");
  await dlg.getByRole("button", { name: "Deactivate" }).click();
  await expect(staff.getByText("Inactive since Oct 13, 2026.")).toBeVisible();

  await staff.goto("/week/2026-10-12");
  await expect(staff.getByLabel("S002 2026-10-13 status")).toBeVisible();
  await expect(staff.getByLabel("S002 2026-10-14 not employed")).toBeVisible();

  await staff.goto("/week/2026-10-19");
  await expect(staff.getByLabel("S002 2026-10-19 status")).toHaveCount(0);
  await owner.goto(staff.url());
  await owner.getByRole("button", { name: /Fill empty cells/ }).click();
  await staff.reload();
  await expect(staff.getByRole("button", { name: /Fill empty cells/ })).toHaveCount(0);
  await staff.getByRole("button", { name: "Generate payroll draft" }).click();
  await expect(staff).toHaveURL(/\/payroll\/[0-9a-f-]{36}$/);
  const next = await netsInDb(staff.url().split("/").pop()!);
  expect(Object.keys(next).sort()).toEqual(["M001", "M002", "M003", "M004", "S001", "T001"]);
  expect(next.M004).toBe(6 * 68000); // owner-approved rate, 6 full days

  expect(Object.keys(await netsInDb(runId))).toContain("S002");
});

test("E2E-CAT-01 owner changes an incentive amount from a future Monday; earlier weeks keep the old amount (US-010)", async () => {
  await owner.goto("/catalog");
  const row = owner.locator("details", { hasText: "Throttle Body Cleaning" });
  await row.locator("summary").click();
  await row.getByLabel("New amount (₱)").fill("180");
  await row.getByLabel("Effective from").fill("2026-10-19");
  await row.getByRole("button", { name: "Change amount" }).click();
  await expect(row.locator("summary")).toContainText("₱180.00 from Oct 19, 2026");
  await owner.goto("/week/2026-10-12?tab=jobs&day=2026-10-14");
  await expect(owner.locator("select[name=job_id] option", { hasText: "TBC" })).toHaveText("TBC · Throttle Body Cleaning (₱150.00)");
  await owner.goto("/week/2026-10-19?tab=jobs&day=2026-10-21");
  await expect(owner.locator("select[name=job_id] option", { hasText: "TBC" })).toHaveText("TBC · Throttle Body Cleaning (₱180.00)");
});
});
