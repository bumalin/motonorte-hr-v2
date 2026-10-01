import { expect, type Page } from "@playwright/test";
import postgres from "postgres";

export type Role = "owner" | "staff";

/** Signs in with the dev account for `role`. Passwords come from .env and are never printed. */
export async function login(page: Page, role: Role) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${role}@motonorte.test`);
  await page.getByLabel("Password").fill(process.env[role === "owner" ? "DEV_OWNER_PASSWORD" : "DEV_STAFF_PASSWORD"] ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

/** Owner connection to the e2e database, for assertions only (the app itself connects as app_user). */
export function e2eSql() {
  const url = process.env.E2E_DATABASE_URL_OWNER!;
  if (new URL(url).pathname !== "/motonorte_e2e") throw new Error("not the e2e database");
  return postgres(url, { max: 1, onnotice: () => {} });
}
