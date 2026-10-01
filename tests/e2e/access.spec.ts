// Per-user tab access and user editing (migration 009). Restores the staff account afterwards for the other specs.
import { test, expect } from "@playwright/test";
import { e2eSql, login } from "./helpers.ts";

test.afterAll(async () => {
  const sql = e2eSql();
  await sql`update users set full_name = 'E2E Staff', tabs = default where email = 'staff@motonorte.test'`;
  await sql.end();
});

test("E2E-ACC-01 owner edits a staff user's name and tabs; staff only sees and opens those tabs", async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  await login(owner, "owner");
  await owner.goto("/settings");
  const row = owner.locator("details", { hasText: "staff@motonorte.test" });
  await row.locator("summary").click();
  await row.getByLabel("Name for staff@motonorte.test").fill("E2E Staff Renamed");
  await row.getByLabel("Payroll").uncheck();
  await row.getByLabel("Reports").uncheck();
  await row.getByRole("button", { name: "Save changes for staff@motonorte.test" }).click();
  await expect(row).toContainText("Saved.");
  await owner.reload();
  await expect(owner.locator("tbody tr", { hasText: "staff@motonorte.test" }).first()).toContainText("E2E Staff Renamed");
  await expect(owner.locator("tbody tr", { hasText: "staff@motonorte.test" }).first()).toContainText("Staff — Dashboard, This week, Employees, Incentive jobs, Settings, Audit log");

  const staff = await (await browser.newContext()).newPage();
  await login(staff, "staff");
  const nav = staff.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Employees" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Payroll" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Reports" })).toHaveCount(0);

  // Route guards, not just hidden links
  await staff.goto("/payroll");
  await expect(staff).toHaveURL(/\/$/);
  await staff.goto("/reports");
  await expect(staff).toHaveURL(/\/$/);
  expect((await staff.request.get("/reports/export?kind=13th&year=2026")).status()).toBe(403);
  await staff.goto("/week");
  await expect(staff.getByRole("button", { name: "Generate payroll draft" })).toHaveCount(0);
});

test("E2E-ACC-02 any past week can be opened from the week picker", async ({ page }) => {
  await login(page, "owner");
  await page.goto("/payroll");
  await page.getByLabel("Go to week of").fill("2025-03-12");
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/week\/2025-03-10$/);
  await expect(page.getByRole("button", { name: "Generate payroll draft" })).toBeVisible();
});
