// Creates or resets an account (no public sign-up, ADR-006). Uses the OWNER connection because no session exists yet.
// Usage: npm run create-user -- --email you@example.com --name "Full Name" --role owner --password-env VAR
// The password is read from the named environment variable (never typed on screen or passed as an argument).
// Re-running for an existing email resets its password/role and signs out all its sessions.
import postgres from "postgres";
import { parseArgs } from "node:util";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../lib/auth/password.ts";
import { Email } from "../lib/auth/email.ts";

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string" }, "password-env": { type: "string" } },
});
const email = Email.safeParse(values.email);
const role = values.role;
const passwordVar = values["password-env"];
if (!email.success || !values.name?.trim() || (role !== "owner" && role !== "staff") || !passwordVar) {
  console.error('usage: npm run create-user -- --email you@example.com --name "Full Name" --role owner|staff --password-env VAR');
  process.exit(1);
}
const password = process.env[passwordVar] ?? "";
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`Environment variable ${passwordVar} must hold a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  process.exit(1);
}

const url = process.env.DATABASE_URL_OWNER;
if (!url) throw new Error("DATABASE_URL_OWNER is not set");
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const u = await sql.begin(async (tx) => {
    const [row] = await tx`insert into users (email, full_name, password_hash, role)
      values (${email.data}, ${values.name!.trim()}, ${await hashPassword(password)}, ${role})
      on conflict (email) do update set password_hash = excluded.password_hash, full_name = excluded.full_name, role = excluded.role, active = true
      returning id`;
    await tx`delete from sessions where user_id = ${row.id}`;
    return row;
  });
  console.log(`user ${email.data} (${role}) ready, id ${u.id}`);
} finally {
  await sql.end();
}
