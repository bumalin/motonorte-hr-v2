// CSV exports for S-10. GET only (read-only data); session required; RLS applies via withUser.
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session.ts";
import { hasTab } from "@/lib/auth/tabs.ts";
import { withUser } from "@/lib/db/client.ts";
import { monthlySummary, pesos, thirteenthMonth, toCsv, validMonth, validYear } from "@/lib/db/reports.ts";

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!hasTab(user, "reports")) return new NextResponse("Forbidden", { status: 403 });
  const p = req.nextUrl.searchParams;
  const kind = p.get("kind");

  if (kind === "monthly") {
    const month = p.get("month") ?? "";
    if (!validMonth(month)) return new NextResponse("Bad month", { status: 400 });
    const rows = await withUser(user.id, (tx) => monthlySummary(tx, `${month}-01`));
    const csv = toCsv(["Code", "Name", "Base", "OT", "Incentives", "Allowances", "Deductions", "Carried in", "Gross", "Net", "Carry out"],
      rows.map((r) => [r.code, r.full_name, pesos(r.base), pesos(r.ot), pesos(r.incentive), pesos(r.allowances), pesos(r.deductions),
        pesos(r.carried_in), pesos(r.gross), pesos(r.net), pesos(r.carry_out)]));
    return csvResponse(csv, `motonorte-monthly-${month}.csv`);
  }
  if (kind === "13th") {
    const year = Number(p.get("year"));
    if (!validYear(year)) return new NextResponse("Bad year", { status: 400 });
    const rows = await withUser(user.id, (tx) => thirteenthMonth(tx, year));
    const csv = toCsv(["Code", "Name", "Total basic", "13th month"], rows.map((r) => [r.code, r.full_name, pesos(r.total_basic), pesos(r.thirteenth)]));
    return csvResponse(csv, `motonorte-13th-month-${year}.csv`);
  }
  return new NextResponse("Unknown report", { status: 400 });
}

function csvResponse(csv: string, filename: string) {
  return new NextResponse("\uFEFF" + csv, { // BOM so Excel reads ₱/UTF-8 names correctly
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}
