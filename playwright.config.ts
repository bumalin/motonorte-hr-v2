// End-to-end tests (docs/07-test-report.md). Runs against a SEPARATE database, motonorte_e2e, never the dev DB.
// Uses the Edge already installed on this machine (no browser download). Run: npm run test:e2e
import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

/** Same server and credentials as .env, database swapped to motonorte_e2e. */
function e2eUrl(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (.env)`);
  const u = new URL(v);
  u.pathname = "/motonorte_e2e";
  return u.toString();
}
process.env.E2E_DATABASE_URL = e2eUrl("DATABASE_URL");
process.env.E2E_DATABASE_URL_OWNER = e2eUrl("DATABASE_URL_OWNER");

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  workers: 1, // one shared database; the payroll cycle is a single ordered story
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "msedge",
    trace: "off", // traces would record the typed passwords
    screenshot: "only-on-failure",
  },
  webServer: {
    // Production build + start, pointed at the e2e database (process env wins over .env in Next).
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    env: { DATABASE_URL: process.env.E2E_DATABASE_URL },
    timeout: 600_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});
