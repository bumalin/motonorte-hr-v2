import { test } from "node:test";
import assert from "node:assert/strict";
import { pesos, toCsv } from "./reports.ts";

test("CSV quotes commas/quotes/newlines and neutralises spreadsheet formulas", () => {
  const csv = toCsv(["Name", "Net"], [["Cruz, Ben", "3927.40"], ['Say "hi"', "1.00"], ["=HYPERLINK(\"x\")", "0.00"], ["+cmd", "0.00"],
    ["-2+3", "0.00"], ["@SUM(A1)", "0.00"], ["\tx", "0.00"], ["\rx", "0.00"]]);
  assert.equal(csv, [
    "Name,Net",
    '"Cruz, Ben",3927.40',
    '"Say ""hi""",1.00',
    `"'=HYPERLINK(""x"")",0.00`,
    "'+cmd,0.00",
    "'-2+3,0.00",
    "'@SUM(A1),0.00",
    "'\tx,0.00",
    `"'\rx",0.00`,
    "",
  ].join("\r\n"));
});

test("pesos from centavos", () => {
  assert.equal(pesos(392740), "3927.40");
  assert.equal(pesos(5), "0.05");
});
