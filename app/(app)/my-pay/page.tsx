import Link from "next/link";
import {hasTab} from "@/lib/auth/tabs.ts";
import {requireTab} from "@/lib/auth/session.ts";
import {withUser} from "@/lib/db/client.ts";
import {payHistory} from "@/lib/portal/data.ts";
import {formatDate,formatMoney,formatWeek,periodStartOf,todayManila} from "@/lib/format.ts";

export default async function MyPay(){
 const user=await requireTab("mypay");
 if(!user.employeeId)return <p>This page is for linked employee accounts. Manage employees under Team members.</p>;
 const data=await withUser(user.id,async tx=>{
  const [employee]=await tx`select e.*,e.hire_date::text as hire_date,t.daily_rate,t.position from employees e
   left join lateral(select daily_rate,position from pay_terms where employee_id=e.id and status='approved' and effective_from<=${todayManila()} order by effective_from desc limit 1)t on true
   where e.id=${user.employeeId}`;
  return {employee,weeks:await payHistory(tx,user.employeeId!)};
 });
 const current=data.weeks.find(w=>w.period===periodStartOf(todayManila()));
 let stale=false;
 if(current&&current.status!=="locked"){
  // Crew cannot read other employees' inputs. The server checks freshness through a narrow function.
  const [{fresh}]=await withUser(user.id,tx=>tx`select crew_run_fresh(${current.runId}) as fresh`);
  stale=!fresh;
 }
 const history=data.weeks.filter(w=>w.status==="locked");
 const e=data.employee;
 const badge=!current?"NOT STARTED":current.status==="locked"?"APPROVED":"BEING PREPARED";
 const note=!current?"Your pay for this week appears here once payroll is prepared."
  :stale?"Attendance or pay inputs changed. Waiting for refreshed payroll."
  :current.status==="locked"?"Approved calculation. Payment is tracked separately."
  :"Estimated pay; this can change until approval.";

 return <div className="portal-wrap">
  <div>
   <p className="eyebrow">— MY PAY · {e?.code}</p>
   <h1 className="portal-title">HI, <span>{e?.full_name.split(" ")[0]}</span></h1>
   <p className="text-text-muted mt-3">See what you earn and how your pay is calculated.</p>
  </div>
  <div className="portal-stats">
   <section className="portal-card portal-hero">
    <div className="flex justify-between gap-3"><h2>This week</h2><span className="portal-badge">{badge}</span></div>
    <p className="portal-amount">{current&&!stale?formatMoney(current.net):"—"}</p>
    <p>{formatWeek(current?.period??periodStartOf(todayManila()))}</p>
    {current&&<p>Scheduled payday: {formatDate(current.payday)}</p>}
    <p className="text-sm text-text-muted mt-3">{note}</p>
    {current&&!stale&&<dl className="portal-breakdown">{([["Basic / base",current.base],["Overtime",current.ot],["Incentives",current.incentive],["Allowances",current.allowances],["Deductions + carried in",current.deductions+current.carriedIn]] as const).map(([label,amount])=><div key={label}><dt>{label}</dt><dd>{formatMoney(amount)}</dd></div>)}</dl>}
   </section>
   <section className="portal-card">
    <h2>About me</h2>
    <dl className="portal-breakdown">
     <div><dt>Daily rate</dt><dd>{e?.daily_rate!=null?formatMoney(e.daily_rate):"—"}</dd></div>
     <div><dt>Designated day off</dt><dd>{e?.rest_day?.toUpperCase()??"—"}</dd></div>
     <div><dt>With us since</dt><dd>{e?.hire_date?formatDate(e.hire_date):"—"}</dd></div>
    </dl>
    {hasTab(user,"profile")&&<Link className="underline block mt-4" href="/my-profile">My profile →</Link>}
   </section>
  </div>
  <section>
   <h2 className="portal-heading">Pay history</h2>
   <p className="text-text-muted mb-4">Approved earnings remain visible without print approval.</p>
   {!history.length&&<p>No approved payroll yet.</p>}
   {history.map(w=><details className="portal-card mb-3" key={w.runId}>
    <summary className="flex flex-wrap justify-between gap-3 cursor-pointer">
     <span>{formatWeek(w.period)}<small className="block text-text-muted">{w.paid>=w.net&&w.paid>0?`Paid ${w.paidOn?formatDate(w.paidOn):""}`:w.paid>0?"Partially paid":"Approved · payment not recorded"}</small></span>
     <strong className="font-mono">{formatMoney(w.net)}</strong>
    </summary>
    <dl className="portal-breakdown">{([["Basic / base",w.base],["Overtime",w.ot],["Incentives",w.incentive],["Allowances",w.allowances],["Gross",w.gross],["Deductions + carried in",w.deductions+w.carriedIn],["Net pay",w.net],["Recorded payment",w.paid],["Balance carried forward",w.carryOut]] as const).map(([label,n])=><div key={label}><dt>{label}</dt><dd>{formatMoney(n)}</dd></div>)}</dl>
    <h3 className="mt-4">How it was calculated</h3>
    <ul className="text-sm space-y-2 mt-2">{w.items.map((i,n)=><li key={n}>{i.detail} · {formatMoney(i.amount)}</li>)}</ul>
    {hasTab(user,"payslips")&&<Link className="portal-button inline-block mt-4" href={`/my-payslips?from=${w.payday}&to=${w.payday}`}>Request payslip PDF</Link>}
   </details>)}
  </section>
 </div>;
}
