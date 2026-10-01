// Past-week entry (PR-072): runs after the payroll cycle, when M004 (hired 2026-10-12) exists.
import { test, expect } from "@playwright/test";
import { e2eSql, login } from "./helpers.ts";

test("E2E-HIST-01 owner includes current employees in a past week; their starting rate is copied back", async ({ page }) => {
  await login(page, "owner");
  await page.goto("/week/2026-09-07");
  const banner = page.getByRole("status").filter({ hasText: "hired after this week" });
  await expect(banner).toContainText("M004");
  await expect(page.getByLabel("M004 2026-09-07 status")).toHaveCount(0);

  await banner.getByRole("button", { name: "Include current employees" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Include them" }).click();
  await expect(page.getByLabel("M004 2026-09-07 status")).toBeVisible();
  await expect(banner).toHaveCount(0);

  const sql = e2eSql();
  try {
    const rows = await sql`select e.hire_date::text as hire, t.daily_rate::int as daily_rate, t.status::text as status from employees e
      join pay_terms t on t.employee_id = e.id and t.effective_from = '2026-09-07' where e.code = 'M004'`;
    expect([...rows]).toEqual([{ hire: "2026-09-07", daily_rate: 68000, status: "approved" }]);
  } finally { await sql.end(); }
});

test("E2E-HIST-02 owner reopens the latest locked week with a reason, and adds back pay on an open week", async ({ page }) => {
  const sql = e2eSql();
  let latest: { id: string; start: string };
  try {
    [latest] = await sql<{ id: string; start: string }[]>`
      select id, period_start::text as start from payroll_runs where status = 'locked' order by period_start desc limit 1`;
  } finally { await sql.end(); }
  await login(page, "owner");
  await page.goto(`/payroll/${latest.id}`);
  await page.getByRole("button", { name: "Reopen week" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Reason").fill("Missed overtime");
  await dlg.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(page.getByText("Reopened by the Owner: Missed overtime")).toBeVisible();

  await page.goto("/week/2026-11-02?tab=adjustments");
  await page.getByLabel("Employee").selectOption({ label: "M001 · Dan Garcia (sample)" });
  await page.getByLabel("Type").selectOption("back_pay");
  await page.getByLabel("Amount (₱)").fill("650");
  await page.getByLabel("Reason").fill("Back pay Sep 22");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator("tbody tr", { hasText: "Back pay Sep 22" })).toContainText("₱650.00");
});

test("E2E-HIST-03 owner applies incentive amounts from an earlier date; jobs can then be logged on a past week", async ({ page }) => {
  await login(page, "owner");
  await page.goto("/week/2025-06-02?tab=jobs&day=2025-06-03");
  await expect(page.getByText("No incentive amounts apply on")).toBeVisible();

  await page.goto("/catalog");
  const form = page.locator("form", { hasText: "Use these amounts for earlier weeks" });
  await form.getByLabel("Apply from").fill("2025-06-02");
  await form.getByRole("button", { name: "Apply" }).click();
  await expect(form).toContainText("now apply from 2025-06-02");

  await page.goto("/week/2025-06-02?tab=jobs&day=2025-06-03");
  await expect(page.getByText("No incentive amounts apply on")).toHaveCount(0);
  await expect(page.getByLabel("Job")).toContainText("TBC");
});

test("E2E-HIST-04 owner removes a mistaken approved rate; the date can be used again", async ({ page }) => {
  const sql = e2eSql();
  let id: string;
  try { [{ id }] = await sql<{ id: string }[]>`select id from employees where code = 'M004'`; } finally { await sql.end(); }
  await login(page, "owner");
  await page.goto(`/employees/${id}?tab=terms`);
  const row = page.locator("tbody tr", { hasText: "Sep 7, 2026" });
  await row.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(row).toContainText("Rejected");

  await page.getByLabel("Effective from").fill("2026-09-07");
  await page.getByLabel("Position").selectOption("staff");
  await page.getByLabel("Daily rate (₱)").fill("600");
  await page.getByRole("button", { name: "Save change" }).click();
  await expect(page.locator("tbody tr", { hasText: "Sep 7, 2026" }).filter({ hasText: "Approved" })).toContainText("Staff");
});

test("E2E-SPEC-01 owner sets a job to one mechanic; logging it credits them in full and keeps it out of the pool (PR-055)", async ({ page }) => {
  await login(page, "owner");
  await page.goto("/catalog");
  const job = page.locator("details", { hasText: "TBC" }).first();
  await job.locator("summary").click();
  await job.getByLabel("Who earns it").selectOption({ label: "Only M002 · Eli Mendoza (sample)" });
  await job.getByRole("button", { name: "Save", exact: true }).click();
  await expect(job).toContainText("now goes in full to that mechanic");
  await page.reload();
  await expect(page.locator("summary", { hasText: "TBC" })).toContainText("Only M002");

  await page.goto("/week/2026-11-02?tab=jobs&day=2026-11-03");
  const jobSelect = page.getByRole("combobox", { name: "Job", exact: true });
  await jobSelect.selectOption((await jobSelect.locator("option", { hasText: "TBC" }).getAttribute("value"))!);
  await expect(jobSelect).toContainText("→ M002 only");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator("tbody tr", { hasText: "TBC" })).toContainText("M002 only");
  await expect(page.getByText(/Paid in full to one mechanic \(not in the pool\): M002/)).toBeVisible();
  await expect(page.getByText("No incentive jobs logged for")).toBeVisible(); // the shared pool stays empty
});
