import { test } from "node:test";
import assert from "node:assert/strict";
import { optionalDate, pesos, toCsv } from "./reports.ts";

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

test("optional date filter accepts real calendar dates only", () => {
  assert.equal(optionalDate("2026-10-11"), "2026-10-11");
  assert.equal(optionalDate("2024-02-29"), "2024-02-29");
  for (const bad of ["", "2026-02-30", "2026-13-01", "2026-1-5", "x", "2026-10-11' or 1=1", null, undefined, ["2026-10-11"]])
    assert.equal(optionalDate(bad), null);
});

test("contribution database errors get plain-language messages", async () => {
  const { dbErrorMessage } = await import("./errors.ts");
  assert.match(dbErrorMessage(new Error("CONTRIBUTION_EMPLOYMENT_FROZEN: reopen the latest affected payroll")), /Reopen the latest affected payroll/);
  assert.match(dbErrorMessage(new Error("CONTRIBUTION_RUN_STALE")), /Employer contribution/); // not the attendance/jobs RUN_STALE text
  assert.match(dbErrorMessage(new Error("RUN_STALE")), /Attendance or jobs changed/);
  assert.match(dbErrorMessage(new Error("Contribution backfill would affect later approved allocation")), /later week/);
});
