import type {Tx} from '../db/client.ts';
import {ROLLOUT_MONTH,type ContributionInput,type ContributionAllocation,type ContributionTerm,type ApprovedAllocation} from './types.ts';
// The result feeds the stale-draft hash, so it carries only what can change this week's allocation: terms of the
// period's employees, and approved allocations in the benefit months this week can touch (the payday's month, or an
// end date's month) that are a final settlement's prior payments or a later payday (backfill guard). Locking an
// unrelated week must not mark this draft stale. The SQL validator still checks entitlement against every approval.
export async function loadContributionInputs(tx:Tx,periodStart:string):Promise<ContributionInput[]>{
 const employees=await tx`select id,hire_date::text,end_date::text from employees where hire_date<=${periodStart}::date+6 and (end_date is null or end_date>=${periodStart}::date) order by code`;
 const ids=employees.map(e=>e.id);
 if(!ids.length)return [];
 const terms=await tx`select id,employee_id,effective_month::text,sss,philhealth,pagibig from employee_contribution_terms where employee_id=any(${ids}::uuid[]) order by employee_id,effective_month`;
 const approved=await tx`select c.employee_id,c.benefit_month::text,c.sss,c.philhealth,c.pagibig,r.payday::text from payroll_contributions c join payroll_runs r on r.id=c.run_id
  where r.status='locked' and r.period_start<>${periodStart}::date and c.employee_id=any(${ids}::uuid[])
  and c.benefit_month in (date_trunc('month',${periodStart}::date)::date,date_trunc('month',${periodStart}::date+6)::date) order by c.employee_id,c.benefit_month,r.payday`;
 const [{payday}]=await tx`select (${periodStart}::date+6)::text as payday`;
 return employees.map(e=>{const final=!!e.end_date&&e.end_date>=periodStart&&e.end_date<=payday;return {employeeId:e.id,hireDate:e.hire_date,endDate:e.end_date,periodStart,payday,rolloutMonth:ROLLOUT_MONTH,
  terms:terms.filter(t=>t.employee_id===e.id).map(t=>({id:t.id,effectiveMonth:t.effective_month,amounts:{sss:t.sss,philhealth:t.philhealth,pagibig:t.pagibig}})) as ContributionTerm[],
  approved:approved.filter(a=>a.employee_id===e.id&&(final||a.payday>payday)).map(a=>({payday:a.payday,benefitMonth:a.benefit_month,amounts:{sss:a.sss,philhealth:a.philhealth,pagibig:a.pagibig}})) as ApprovedAllocation[]};});
}
const toAllocation=(c:Record<string,unknown>)=>({employeeId:c.employee_id,benefitMonth:c.benefit_month,amounts:{sss:c.sss,philhealth:c.philhealth,pagibig:c.pagibig},monthly:{sss:c.monthly_sss,philhealth:c.monthly_philhealth,pagibig:c.monthly_pagibig},classification:c.classification,provenance:c.provenance}) as ContributionAllocation;
export async function loadRunContributions(tx:Tx,runId:string):Promise<ContributionAllocation[]|null>{
 const [run]=await tx`select contributions_recorded from payroll_runs where id=${runId}`;
 if(!run?.contributions_recorded)return null;
 const rows=await tx`select employee_id,benefit_month::text,sss,philhealth,pagibig,monthly_sss,monthly_philhealth,monthly_pagibig,classification,provenance from payroll_contributions where run_id=${runId} order by employee_id,benefit_month`;
 return rows.map(toAllocation);
}
/** One employee's saved allocations for many runs in one query, keyed by run id (benefit-month order). */
export async function employeeRunContributions(tx:Tx,employeeId:string,runIds:string[]):Promise<Map<string,ContributionAllocation[]>>{
 const byRun=new Map<string,ContributionAllocation[]>();
 if(!runIds.length)return byRun;
 const rows=await tx`select run_id,employee_id,benefit_month::text,sss,philhealth,pagibig,monthly_sss,monthly_philhealth,monthly_pagibig,classification,provenance from payroll_contributions where employee_id=${employeeId} and run_id=any(${runIds}::uuid[]) order by run_id,benefit_month`;
 for(const r of rows){const list=byRun.get(r.run_id)??[];list.push(toAllocation(r));byRun.set(r.run_id,list);}
 return byRun;
}
export function databaseAllocations(allocations:ContributionAllocation[]){return allocations.map(c=>({employee_id:c.employeeId,benefit_month:c.benefitMonth,...c.amounts,monthly_sss:c.monthly.sss,monthly_philhealth:c.monthly.philhealth,monthly_pagibig:c.monthly.pagibig,classification:c.classification,term_id:c.provenance.termId,provenance:c.provenance}));}
