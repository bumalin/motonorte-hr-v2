// Applies db/migrations/*.sql in filename order, each in its own transaction (ADR-012).
// Usage: node db/migrate.ts [--reset]   (--reset drops everything first — dev only)
import postgres from "postgres";
import { readdirSync, readFileSync } from "node:fs";

const url = process.env.DATABASE_URL_OWNER;
if (!url) throw new Error("DATABASE_URL_OWNER is not set");
const dir = new URL("./migrations/", import.meta.url);
const sql = postgres(url, { onnotice: () => {}, max: 1 });

try {
  if (process.argv.includes("--reset")) {
    await sql`drop schema public cascade`;
    await sql`create schema public`;
    console.log("reset: schema dropped and recreated");
  }
  await sql`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql<{ version: string }[]>`select version from schema_migrations`).map((r) => r.version));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(new URL(file, dir), "utf8")).simple();
      await tx`insert into schema_migrations (version) values (${file})`;
    });
    console.log(`applied ${file}`);
    count++;
  }
  console.log(count ? `${count} migration(s) applied` : "up to date");
} finally {
  await sql.end();
}
