import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, parsePesos, formatDay, formatDate, formatWeek, todayManila, periodStartOf } from "./format.ts";

test("money from centavos", () => {
  assert.equal(formatMoney(1234567), "₱12,345.67");
  assert.equal(formatMoney(20313), "₱203.13");
  assert.equal(formatMoney(5), "₱0.05");
  assert.equal(formatMoney(0), "₱0.00");
  assert.equal(formatMoney(-15000), "−₱150.00");
  assert.equal(formatMoney(123456789012), "₱1,234,567,890.12");
  assert.throws(() => formatMoney(0.5), /integer centavos/);
  assert.throws(() => formatMoney(NaN), /integer centavos/);
});

test("parse pesos to centavos", () => {
  assert.equal(parsePesos("150"), 15000);
  assert.equal(parsePesos("150.5"), 15050);
  assert.equal(parsePesos("1,234.56"), 123456);
  assert.equal(parsePesos(" 0.05 "), 5);
  assert.equal(parsePesos("-5"), null);
  assert.equal(parsePesos("1.234"), null);
  assert.equal(parsePesos("abc"), null);
});

test("dates never shift across time zones", () => {
  assert.equal(formatDay("2026-10-05"), "Mon Oct 5");
  assert.equal(formatDate("2026-10-11"), "Oct 11, 2026");
});

test("week labels", () => {
  assert.equal(formatWeek("2026-10-05"), "Oct 5 – 11, 2026");
  assert.equal(formatWeek("2026-09-28"), "Sep 28 – Oct 4, 2026");
  assert.equal(formatWeek("2026-12-28"), "Dec 28, 2026 – Jan 3, 2027");
});

test("Manila today and period start", () => {
  // 2026-10-04 17:00 UTC is already Monday Oct 5 in Manila (UTC+8)
  assert.equal(todayManila(new Date("2026-10-04T17:00:00Z")), "2026-10-05");
  assert.equal(periodStartOf("2026-10-11"), "2026-10-05");
  assert.equal(periodStartOf("2026-10-05"), "2026-10-05");
  assert.equal(periodStartOf("2026-10-07"), "2026-10-05");
});
