// Creates (once) and resets (every run) the e2e database: migrate --reset, seed, two test users.
// Never touches the dev database: refuses any URL whose database isn't motonorte_e2e.
import postgres from "postgres";
import { execFileSync } from "node:child_process";

export default async function globalSetup() {
  const owner = process.env.E2E_DATABASE_URL_OWNER;
  if (!owner || new URL(owner).pathname !== "/motonorte_e2e") throw new Error("E2E_DATABASE_URL_OWNER must point at motonorte_e2e");

  const admin = new URL(owner);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const [{ exists }] = await sql`select exists (select 1 from pg_database where datname = 'motonorte_e2e') as exists`;
    if (!exists) await sql.unsafe("create database motonorte_e2e");
    await sql.unsafe("revoke temporary on database motonorte_e2e from public");
  } finally {
    await sql.end();
  }

  const env = { ...process.env, DATABASE_URL_OWNER: owner };
  const run = (...args: string[]) => execFileSync(process.execPath, args, { env, stdio: "pipe" });
  run("db/migrate.ts", "--reset");
  run("db/run-sql.ts", "db/seed.sql");
  for (const [role, name, pw] of [["owner", "E2E Owner", "DEV_OWNER_PASSWORD"], ["staff", "E2E Staff", "DEV_STAFF_PASSWORD"]]) {
    run("scripts/create-user.ts", "--email", `${role}@motonorte.test`, "--name", name, "--role", role, "--password-env", pw);
  }
}
