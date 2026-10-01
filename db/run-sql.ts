// Runs one SQL file with the owner connection, printing NOTICEs. Used for seed and verify.
// Usage: node db/run-sql.ts <file.sql>
import postgres from "postgres";
import { readFileSync } from "node:fs";

const url = process.env.DATABASE_URL_OWNER;
const file = process.argv[2];
if (!url) throw new Error("DATABASE_URL_OWNER is not set");
if (!file) throw new Error("usage: node db/run-sql.ts <file.sql>");

const sql = postgres(url, { max: 1, onnotice: (n) => console.log(n.message) });
try {
  await sql.unsafe(readFileSync(file, "utf8")).simple();
  console.log(`ok: ${file}`);
} catch (e) {
  console.error(`FAILED: ${file}\n${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
