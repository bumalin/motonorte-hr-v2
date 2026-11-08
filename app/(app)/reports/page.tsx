import { requireTab } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { monthlySummary, optionalDate, payrollTotals, thirteenthMonth, validMonth, validYear, type MonthlyRow, type TotalsRow } from "@/lib/db/reports.ts";
import { formatDate, todayManila } from "@/lib/format.ts";
import { Money } from "@/components/ui.tsx";

// S-10 Reports — payroll totals (all time or a payday range), US-040 monthly summary (for the accountant), US-041 13th month. Locked runs only.
const th = "px-3 py-2 font-medium";
const td = "px-3 py-2 text-right";

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const user = await requireTab("reports");
  const sp = await searchParams;
  const today = todayManila();
  const month = typeof sp.month === "string" && validMonth(sp.month) ? sp.month : today.slice(0, 7);
  const year = validYear(Number(sp.year)) ? Number(sp.year) : Number(today.slice(0, 4));
  const from = optionalDate(sp.from), to = optionalDate(sp.to);
  const { totals, monthly, thirteenth } = await withUser(user.id, async (tx) => ({
    totals: await payrollTotals(tx, from, to),
    monthly: await monthlySummary(tx, `${month}-01`),
    thirteenth: await thirteenthMonth(tx, year),
  }));
  const total = (k: "weeks" | "gross" | "incentive" | "net") => totals.reduce((s, r: TotalsRow) => s + r[k], 0);
  const range = from || to ? `${from ? formatDate(from) : "the first payroll"} – ${to ? formatDate(to) : "today"}` : "all time";
  const keep = (...names: ("month" | "year" | "from" | "to")[]) => names.map((n) => {
    const v = { month, year: String(year), from, to }[n];
    return v ? <input key={n} type="hidden" name={n} value={v} /> : null;
  });
  const sum = (k: keyof MonthlyRow) => monthly.reduce((s, r) => s + (r[k] as number), 0);
  const cols: [keyof MonthlyRow, string][] = [["base", "Base"], ["ot", "OT"], ["incentive", "Incentives"], ["allowances", "Allowances"],
    ["deductions", "Deductions"], ["carried_in", "Carried in"], ["gross", "Gross"], ["net", "Net"], ["carry_out", "Carry out"]];

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-semibold">Reports</h1>
      <a href="/reports/contributions" className="inline-block font-medium text-brand-700 underline">Employer government contributions report →</a>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className="text-lg font-medium">Payroll totals</h2>
          <form className="flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="from">Payday from</label>
            <input id="from" name="from" type="date" defaultValue={from ?? ""} className="rounded-md border border-border px-2 py-1" />
            <label htmlFor="to">to</label>
            <input id="to" name="to" type="date" defaultValue={to ?? ""} className="rounded-md border border-border px-2 py-1" />
            {keep("month", "year")}
            <button className="rounded-md border border-border px-2 py-1">Show</button>
            {(from || to) && <a href={`/reports?month=${month}&year=${year}`} className="text-brand-700 hover:underline">All time</a>}
          </form>
          <a href={`/reports/export?kind=totals${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`} className="text-sm font-medium text-brand-700 hover:underline">Export CSV</a>
        </div>
        <p className="text-xs text-text-muted">Approved (locked) payroll only, counted by Sunday payday — {range}. Payroll = gross pay; incentives are included in it. Drafts are never counted.</p>
        {totals.length === 0 ? <p className="text-sm text-text-muted">No approved payroll in this range.</p> : (<>
          <div className="grid gap-3 sm:grid-cols-3">
            {([["Total payroll (gross)", total("gross")], ["Total incentives", total("incentive")], ["Total net pay", total("net")]] as const).map(([label, v]) => (
              <div key={label} className="rounded-md border border-border bg-surface p-4"><p className="text-sm text-text-muted">{label}</p><p className="text-2xl font-semibold tabular"><Money value={v} /></p></div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="responsive-table w-full rounded-md border border-border bg-surface text-sm">
              <thead className="bg-surface-2 text-text-muted"><tr><th scope="col" className={`${th} text-left`}>Employee</th><th scope="col" className={`${th} text-right`}>Approved weeks</th><th scope="col" className={`${th} text-right`}>Payroll (gross)</th><th scope="col" className={`${th} text-right`}>Incentives</th><th scope="col" className={`${th} text-right`}>Net pay</th></tr></thead>
              <tbody>
                {totals.map((r) => (
                  <tr key={r.code} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 text-left font-normal"><span className="font-mono">{r.code}</span> · {r.full_name}</th>
                    <td data-label="Approved weeks" className={`${td} tabular`}>{r.weeks}</td>
                    <td data-label="Payroll (gross)" className={td}><Money value={r.gross} /></td>
                    <td data-label="Incentives" className={td}><Money value={r.incentive} /></td>
                    <td data-label="Net pay" className={td}><Money value={r.net} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border bg-surface-2 font-medium">
                <tr><th scope="row" className="px-3 py-2 text-left">Total</th><td className={`${td} tabular`}>{total("weeks")}</td><td className={td}><Money value={total("gross")} /></td><td className={td}><Money value={total("incentive")} /></td><td className={td}><Money value={total("net")} /></td></tr>
              </tfoot>
            </table>
          </div>
        </>)}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className="text-lg font-medium">Monthly summary</h2>
          <form className="flex items-center gap-2 text-sm">
            <label htmlFor="month">Month</label>
            <input id="month" name="month" type="month" defaultValue={month} className="rounded-md border border-border px-2 py-1" />
            {keep("year", "from", "to")}
            <button className="rounded-md border border-border px-2 py-1">Show</button>
          </form>
          <a href={`/reports/export?kind=monthly&month=${month}`} className="text-sm font-medium text-brand-700 hover:underline">Export CSV</a>
        </div>
        <p className="text-xs text-text-muted">Weeks count toward the month of their Sunday payday. For the accountant&apos;s government contributions (SSS, PhilHealth, Pag-IBIG).</p>
        {monthly.length === 0 ? <p className="text-sm text-text-muted">No locked payroll runs paid in this month.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] rounded-md border border-border bg-surface text-sm">
            <thead className="bg-surface-2 text-text-muted"><tr><th scope="col" className={`${th} text-left`}>Employee</th>{cols.map(([, l]) => <th key={l} scope="col" className={`${th} text-right`}>{l}</th>)}</tr></thead>
            <tbody>
              {monthly.map((r) => (
                <tr key={r.code} className="border-t border-border">
                  <th scope="row" className="px-3 py-2 text-left font-normal"><span className="font-mono">{r.code}</span> · {r.full_name}</th>
                  {cols.map(([k]) => <td key={k} className={td}><Money value={r[k] as number} /></td>)}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border bg-surface-2 font-medium">
              <tr><th scope="row" className="px-3 py-2 text-left">Total</th>{cols.map(([k]) => <td key={k} className={td}><Money value={sum(k)} /></td>)}</tr>
            </tfoot>
          </table></div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className="text-lg font-medium">13th month pay</h2>
          <form className="flex items-center gap-2 text-sm">
            <label htmlFor="year">Year</label>
            <input id="year" name="year" type="number" min={2000} max={2100} defaultValue={year} className="w-24 rounded-md border border-border px-2 py-1" />
            {keep("month", "from", "to")}
            <button className="rounded-md border border-border px-2 py-1">Show</button>
          </form>
          <a href={`/reports/export?kind=13th&year=${year}`} className="text-sm font-medium text-brand-700 hover:underline">Export CSV</a>
        </div>
        <p className="text-xs text-text-muted">Total basic pay ÷ 12, from runs paid in {year}. Incentives, overtime and allowances are excluded (PR-080).</p>
        {thirteenth.length === 0 ? <p className="text-sm text-text-muted">No locked payroll runs paid in {year}.</p> : (
          <table className="w-full max-w-2xl rounded-md border border-border bg-surface text-sm">
            <thead className="bg-surface-2 text-text-muted"><tr><th scope="col" className={`${th} text-left`}>Employee</th><th scope="col" className={`${th} text-right`}>Total basic</th><th scope="col" className={`${th} text-right`}>13th month</th></tr></thead>
            <tbody>
              {thirteenth.map((r) => (
                <tr key={r.code} className="border-t border-border">
                  <th scope="row" className="px-3 py-2 text-left font-normal"><span className="font-mono">{r.code}</span> · {r.full_name}</th>
                  <td className={td}><Money value={r.total_basic} /></td>
                  <td className={`${td} font-medium`}><Money value={r.thirteenth} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
