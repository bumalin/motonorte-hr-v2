import type {Tx} from "../db/client.ts";
import {describeItem} from "../payroll/describe.ts";
import type {PayWeek,PayslipSnapshot} from "./types.ts";
export async function payHistory(tx:Tx,employeeId:string,start?:string,end?:string):Promise<PayWeek[]>{
 const rows=await tx`select r.id as "runId",r.locked_at::text as version,r.period_start::text as period,(r.period_start+6)::text as "end",r.payday::text as payday,r.status,
 l.basic,l.base,l.ot,l.incentive,l.allowances,l.deductions,l.carried_in as "carriedIn",l.carry_out as "carryOut",l.gross,l.net,
 (select coalesce(sum(p.amount),0)::bigint from payroll_payments p where p.run_id=r.id and p.employee_id=l.employee_id) as paid,
 (select max(p.paid_on)::text from payroll_payments p where p.run_id=r.id and p.employee_id=l.employee_id) as "paidOn"
 from payroll_runs r join payroll_lines l on l.run_id=r.id where l.employee_id=${employeeId}
 and (${start??null}::date is null or r.payday>=${start??null}::date) and (${end??null}::date is null or r.payday<=${end??null}::date)
 order by r.payday desc`;
 const weeks:PayWeek[]=[];
 for(const row of rows){const items=await tx`select employee_id,date::text,kind,amount,rule_id,source from payroll_items where run_id=${row.runId} and employee_id=${employeeId} order by date nulls last,id`;
  const baseItems=items.filter(i=>i.kind==='base');
 const rates=[...new Set(baseItems.map(i=>Number(i.source.dailyRate)).filter(Number.isFinite))];
 const daysPaid=baseItems.length?baseItems.reduce((sum,i)=>sum+(i.source.status==='F'?1:i.source.status==='H'?0.5:0),0):undefined;
 weeks.push({...row,daysPaid,dailyRate:rates.length===1?rates[0]:undefined,items:items.map(i=>({kind:i.kind,amount:i.amount,detail:describeItem(i as Parameters<typeof describeItem>[0])}))} as PayWeek);}
 return weeks;
}
export async function documentSnapshot(tx:Tx,employeeId:string,start:string,end:string):Promise<PayslipSnapshot>{
 const [e]=await tx`select id,full_name,code,rest_day,hire_date::text from employees where id=${employeeId}`;
 if(!e)throw new Error("Employee not found");
 const weeks=(await payHistory(tx,employeeId,start,end)).filter(w=>w.status==="locked");
 if(!weeks.length)throw new Error("No approved payroll in this range.");
 return {employeeId,hireDate:e.hire_date,restDay:e.rest_day,name:e.full_name,code:e.code,rangeStart:start,rangeEnd:end,weeks};
}
