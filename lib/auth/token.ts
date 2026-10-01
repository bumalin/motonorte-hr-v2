// Session tokens: 32 random bytes in the cookie; only the SHA-256 hash is stored in the DB.
import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "mn_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h, sliding
// Login throttle limits live in SQL: auth_throttle() in db/migrations/006_login_hardening.sql

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
