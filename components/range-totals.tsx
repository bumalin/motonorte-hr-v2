import type {RangeSummary} from "@/lib/portal/summary.ts";
import {formatMoney} from "@/lib/format.ts";
export function RangeTotals({summary:s}:{summary:RangeSummary}){
 return <section aria-label="Selected range totals" className="border border-border p-4 space-y-3">
 <h3 className="font-bold">{s.wholeMonth?"Monthly payslip totals":"Selected range totals"}</h3>
 <p>{s.rangeStart} to {s.rangeEnd} · {s.approvedWeeks} approved {s.approvedWeeks===1?"week":"weeks"}</p>
 <dl className="portal-breakdown">{[["Basic pay",s.base],["Overtime",s.ot],["Incentives",s.incentive],["Allowances",s.allowances],["Gross pay",s.gross],["Deductions",s.deductions],["Carried in",s.carriedIn],["Total net pay",s.net]].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{formatMoney(Number(value))}</dd></div>)}</dl>
 {!!s.missingPaydays.length&&<p className="text-sm" role="status"><strong>Partial {s.wholeMonth?"month":"range"}:</strong> no approved payroll for {s.missingPaydays.join(", ")}. These paydays are excluded from the totals.</p>}
 <h4 className="font-semibold">Employer government contributions</h4><dl className="portal-breakdown">{[["SSS",s.contributions.sss],["PhilHealth",s.contributions.philhealth],["Pag-IBIG",s.contributions.pagibig],["Recorded employer total",s.contributions.total]].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{s.contributions.recordedWeeks?formatMoney(Number(value)):"Not recorded"}</dd></div>)}</dl>
 {!!s.contributions.missingWeeks&&<p className="text-sm">Incomplete contribution coverage: {s.contributions.missingWeeks} included week(s) have no recorded contribution metadata.</p>}
 {!!s.contributions.benefitMonths.length&&<p className="text-sm">Benefit months: {s.contributions.benefitMonths.map(m=>m.slice(0,7)).join(', ')}. Fully employer-funded; excluded from gross and net pay.</p>}
 <p className="text-sm text-text-muted">Totals combine approved weekly calculations by scheduled payday. Approval of payroll does not confirm payment.</p>
 </section>;
}
