import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, verifyDummy } from "./password.ts";
import { hashToken, newToken } from "./token.ts";

test("password hash round-trips and rejects wrong passwords", async () => {
  const h = await hashPassword("correct horse battery");
  assert.match(h, /^scrypt\$65536\$8\$1\$/);
  assert.equal(await verifyPassword("correct horse battery", h), true);
  assert.equal(await verifyPassword("correct horse batterY", h), false);
});

test("same password gets different salts", async () => {
  assert.notEqual(await hashPassword("correct horse battery"), await hashPassword("correct horse battery"));
});

test("short passwords are refused", async () => {
  await assert.rejects(hashPassword("short"), /at least 12/);
});

test("malformed stored hashes never verify", async () => {
  assert.equal(await verifyPassword("anything", "not-a-hash"), false);
  assert.equal(await verifyPassword("anything", "bcrypt$x$y"), false);
  assert.equal(await verifyDummy("anything"), false);
});

test("session tokens are 256-bit and stored only as sha256 hex", () => {
  const t = newToken();
  assert.equal(Buffer.from(t, "base64url").length, 32);
  assert.notEqual(newToken(), t);
  assert.match(hashToken(t), /^[0-9a-f]{64}$/);
  assert.equal(hashToken(t), hashToken(t));
});
