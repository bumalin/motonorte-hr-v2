import Image from "next/image";
import {formatDate,formatMoney,formatWeek,positionLabel} from "@/lib/format.ts";
import {describeItem,type RunItem} from "@/lib/payroll/describe.ts";
type SlipLine={employee_id:string;code:string;full_name:string;position:string|null;hire_date:string;base:number;ot:number;incentive:number;allowances:number;deductions:number;carried_in:number;carry_out:number;gross:number;net:number};
export function PrintablePayslip({line:l,period,payday,locked,preparedBy,items,restDays}:{line:SlipLine;period:string;payday:string;locked:string;preparedBy:string;items:RunItem[];restDays:string[]}){
 const base=items.filter(i=>i.kind==="base");
 const rates=[...new Set(base.map(i=>Number(i.source.dailyRate)).filter(Number.isFinite))];
 const days=base.length?base.reduce((n,i)=>n+(i.source.status==="F"?1:i.source.status==="H"?0.5:0),0):undefined;
 const rate=rates.length===1?rates[0]:undefined;
 const row=(label:string,detail:string,amount:number,total=false)=><div className={"print-slip-row"+(total?" print-slip-total":"")}><strong>{label}</strong><span>{detail}</span><b>{formatMoney(amount)}</b></div>;
 const heading=(label:string)=><div className="print-slip-columns"><span>{label}</span><span>DETAILS</span><span>AMOUNT</span></div>;
 const brand=<header className="print-slip-header"><div><Image unoptimized src="/brand/motonorte-logo.svg" alt="MotoNorte" width={210} height={43}/><span>HR &amp; PAYROLL</span></div><div><b>PAYSLIP</b><span>{formatWeek(period)}</span></div></header>;
 return <div className="print-slip-group">
 <article className="print-slip">
 {brand}
 <div className="print-slip-content">
 <section className="print-slip-person"><div><span className="print-slip-label">PAID TO</span><h2>{l.full_name}</h2><p>{l.position?positionLabel(l.position)+" · ":""}Employee <b>{l.code}</b> · With MotoNorte since {formatDate(l.hire_date)}</p></div><dl><div><dt>Pay period</dt><dd>{formatWeek(period)}</dd></div><div><dt>Payday</dt><dd>{formatDate(payday)}</dd></div><div><dt>Daily rate</dt><dd>{rate===undefined?"See calculation detail":formatMoney(rate)}</dd></div><div><dt>Day off taken</dt><dd>{restDays.join(", ")||"None recorded"}</dd></div></dl></section>
 <section className="print-slip-net"><div><span><strong>NET PAY</strong><small>Take-home for this pay period</small></span><b>{formatMoney(l.net)}</b></div><aside><span>DAYS PAID</span><strong>{days??"—"}</strong></aside></section>
 <section>{heading("EARNINGS")}{row("Basic pay",days!==undefined&&rate!==undefined&&l.base===Math.round(days*rate)?days+" days × "+formatMoney(rate):"See frozen calculation detail",l.base)}{row("Overtime","Approved overtime",l.ot)}{row("Incentives","Shared pool + personal jobs",l.incentive)}{row("Allowances","Approved allowances",l.allowances)}{row("Gross pay","",l.gross,true)}</section>
 <section>{heading("DEDUCTIONS")}{row("Deductions",l.deductions?"Approved deductions":"None this pay period",l.deductions)}{row("Carried in / out","In "+formatMoney(l.carried_in)+" / Out "+formatMoney(l.carry_out),l.carried_in)}</section>
 <div className="print-slip-equation">{formatMoney(l.gross)} gross − {formatMoney(l.deductions+l.carried_in)} deductions = <strong>{formatMoney(l.net)} net</strong>{l.carry_out>0&&<small>{formatMoney(l.carry_out)} carried forward</small>}</div>
 <section className="print-slip-signatures"><div><i/><strong>Prepared by: {preparedBy}</strong><span>Payroll locked {formatDate(locked)}</span></div><div><i/><strong>Received by: {l.full_name}</strong><span>Date: ____________________</span></div></section>
 <p className="print-slip-note">System-generated payslip from MotoNorte HR &amp; Payroll. Keep it for your records. Questions? Talk to the Administrator.</p>
 </div>
 <footer className="print-slip-footer"><div><Image unoptimized src="/brand/motonorte-logo.svg" alt="" width={120} height={25}/></div><div><span>Back of Addessa, Cangrunaan,<br/>Batac, Ilocos Norte</span><span>0932 440 6593<br/>motonorteph</span><span>motonorteph@gmail.com<br/>Open daily, 8:30 AM - 5:30 PM</span></div></footer>
 </article>
 {items.length>0&&<article className="print-slip-detail">{brand}<div><h2>{l.full_name} · Calculation detail</h2><p>{formatWeek(period)} · Employee {l.code}</p>{items.map((item,i)=><div className="print-slip-detail-row" key={i}><span>{describeItem(item)}</span><b>{formatMoney(item.amount)}</b></div>)}</div></article>}
 </div>;
}
