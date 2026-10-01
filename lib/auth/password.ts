// Password hashing with Node's scrypt (ADR-009). Format: scrypt$N$r$p$salt$hash (base64url).
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 2 ** 16, R = 8, P = 1, KEYLEN = 64;
export const MIN_PASSWORD_LENGTH = 12;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEYLEN, { ...opts, maxmem: 256 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await derive(password, Buffer.from(salt, "base64url"), { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Burn the same time as a real verify when the user doesn't exist (no user-enumeration timing). */
const DUMMY = `scrypt$${N}$${R}$${P}$${randomBytes(16).toString("base64url")}$${randomBytes(KEYLEN).toString("base64url")}`;
export async function verifyDummy(password: string): Promise<false> {
  await verifyPassword(password, DUMMY);
  return false;
}
