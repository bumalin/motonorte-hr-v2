// US-061: sign in / out, generic error, throttle, route protection.
import { test, expect } from "@playwright/test";
import { login } from "./helpers.ts";

test("E2E-AUTH-01 unauthenticated pages redirect to sign in", async ({ page }) => {
  await page.goto("/payroll");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "HR & Payroll" })).toBeVisible();
  await expect(page.getByText(/sign up|forgot/i)).toHaveCount(0); // no public sign-up (UX S-01)
});

test("E2E-AUTH-02 wrong password gets the generic message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("staff@motonorte.test");
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form p[role=alert]")).toHaveText("Email or password is incorrect.");
  await expect(page).toHaveURL(/\/login$/);
});

test("E2E-AUTH-03 sign in shows role badge; sign out ends the session server-side", async ({ page, context }) => {
  await login(page, "staff");
  await expect(page.locator("header")).toContainText("E2E Staff");
  await expect(page.locator("header")).toContainText("staff");
  const before = (await context.cookies()).find((c) => c.name === "mn_session");
  expect(before).toBeTruthy();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Replaying the old cookie must not work: logout deleted the session row
  await context.addCookies([before!]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("E2E-AUTH-04 sixth failed attempt within 15 minutes is throttled", async ({ page }) => {
  await page.goto("/login");
  const email = "throttle-e2e@motonorte.test"; // not a real account, so no real user gets locked out
  for (let i = 1; i <= 6; i++) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(`wrong-${i}`);
    // Wait for each server action to finish: the message text alone doesn't change between attempts 1–5
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/login")),
      page.getByRole("button", { name: "Sign in" }).click(),
    ]);
    const expected = i <= 5 ? "Email or password is incorrect." : "Too many attempts. Try again in 15 minutes.";
    await expect(page.locator("form p[role=alert]")).toHaveText(expected);
  }
});
