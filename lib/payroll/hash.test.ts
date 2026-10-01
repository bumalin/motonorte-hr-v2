import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson } from "./hash.ts";
import { mergeSettings } from "../db/loadPeriodInput.ts";

test("canonical JSON ignores object key order but not array order", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [3, 1] } }), canonicalJson({ a: { c: [3, 1], d: 2 }, b: 1 }));
  assert.notEqual(canonicalJson({ a: [1, 3] }), canonicalJson({ a: [3, 1] }));
  assert.notEqual(canonicalJson({ a: null }), canonicalJson({ a: 0 }));
});

test("per-key settings rows merge into complete dated bundles", () => {
  const rows = [
    { key: "rest_day_worked_multiplier", from: "2000-01-01", value: 100 },
    { key: "holiday_worked_multiplier", from: "2000-01-01", value: 100 },
    { key: "holiday_unworked_multiplier", from: "2000-01-01", value: 0 },
    { key: "ot_multiplier", from: "2000-01-01", value: 125 },
    { key: "ot_multiplier", from: "2026-11-02", value: 130 },
    { key: "rest_day_worked_multiplier", from: "2027-01-04", value: 130 },
  ];
  assert.deepEqual(mergeSettings(rows), [
    { from: "2000-01-01", restDayWorked: 100, holidayWorked: 100, holidayUnworked: 0, ot: 125 },
    { from: "2026-11-02", restDayWorked: 100, holidayWorked: 100, holidayUnworked: 0, ot: 130 },
    { from: "2027-01-04", restDayWorked: 130, holidayWorked: 100, holidayUnworked: 0, ot: 130 },
  ]);
});

test("a date where some key has no value yet produces no bundle", () => {
  assert.deepEqual(mergeSettings([{ key: "ot_multiplier", from: "2000-01-01", value: 125 }]), []);
});
