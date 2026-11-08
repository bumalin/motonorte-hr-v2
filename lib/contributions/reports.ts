import type {Tx} from '../db/client.ts';
import {benefitEligibilityMonth,nextMonth} from './calculate.ts';import {ROLLOUT_MONTH,BENEFITS,type BenefitAmounts} from './types.ts';
export type ContributionReportRow={employeeId:string;code:string;name:string;planned:BenefitAmounts|null;approved:BenefitAmounts;remaining:BenefitAmounts|null;legacyWeeks:number};
export type ContributionReportAllocation={code:string;name:string;period:string;payday:string;benefitMonth:string;classification:string;amounts:BenefitAmounts};
export async function contributionReport(tx:Tx,month:string){
 const candidates=await tx`select e.id,e.code,e.full_name,e.hire_date::text,e.end_date::text,t.sss,t.philhealth,t.pagibig,
  (select count(*)::int from payroll_runs r join payroll_lines l on l.run_id=r.id where l.employee_id=e.id and r.status='locked' and not r.contributions_recorded and r.payday>=${month}::date and r.payday<${nextMonth(month)}::date) as legacy_weeks
  from employees e left join lateral(select sss,philhealth,pagibig from employee_contribution_terms where employee_id=e.id and effective_month<=${month}::date order by effective_month desc limit 1)t on true
  where e.hire_date<${nextMonth(month)}::date and (e.end_date is null or e.end_date>=${month}::date) order by e.code`;
 const rows=await tx`select e.id,e.code,e.full_name,r.period_start::text,r.payday::text,c.benefit_month::text,c.classification,c.sss,c.philhealth,c.pagibig,c.monthly_sss,c.monthly_philhealth,c.monthly_pagibig
  from payroll_contributions c join payroll_runs r on r.id=c.run_id join employees e on e.id=c.employee_id where r.status='locked' and c.benefit_month=${month}::date order by e.code,r.payday`;
 const employees:ContributionReportRow[]=candidates.filter(e=>benefitEligibilityMonth(e.hire_date,ROLLOUT_MONTH)<=month).map(e=>{
 const saved=rows.filter(r=>r.id===e.id);const first=saved[0];
 // A historical planned entitlement is fixed once an allocation is approved.
 const planned=first?{sss:first.monthly_sss,philhealth:first.monthly_philhealth,pagibig:first.monthly_pagibig}:e.sss==null?null:{sss:e.sss,philhealth:e.philhealth,pagibig:e.pagibig};
 const approved={sss:0,philhealth:0,pagibig:0};for(const r of saved)for(const k of BENEFITS)approved[k]+=r[k];
 const remaining=planned?{sss:planned.sss-approved.sss,philhealth:planned.philhealth-approved.philhealth,pagibig:planned.pagibig-approved.pagibig}:null;
 return {employeeId:e.id,code:e.code,name:e.full_name,planned,approved,remaining,legacyWeeks:e.legacy_weeks};});
 // Include frozen rows even if a later employment edit would otherwise hide the employee.
 for(const r of rows)if(!employees.some(e=>e.employeeId===r.id)){const saved=rows.filter(x=>x.id===r.id),approved={sss:0,philhealth:0,pagibig:0};for(const c of saved)for(const k of BENEFITS)approved[k]+=c[k];const planned={sss:r.monthly_sss,philhealth:r.monthly_philhealth,pagibig:r.monthly_pagibig};employees.push({employeeId:r.id,code:r.code,name:r.full_name,planned,approved,remaining:{sss:planned.sss-approved.sss,philhealth:planned.philhealth-approved.philhealth,pagibig:planned.pagibig-approved.pagibig},legacyWeeks:0});}
 const sum=(field:'planned'|'approved'|'remaining')=>employees.reduce((s,e)=>{for(const k of BENEFITS){s[k]+=e[field]?.[k]??0;if(!Number.isSafeInteger(s[k]))throw new Error('Invalid contribution total');}return s;},{sss:0,philhealth:0,pagibig:0});
 const totals={planned:sum('planned'),approved:sum('approved'),remaining:sum('remaining'),unconfigured:employees.filter(e=>!e.planned).length,legacyWeeks:employees.reduce((s,e)=>s+e.legacyWeeks,0)};
 const allocations:ContributionReportAllocation[]=rows.map(r=>({code:r.code,name:r.full_name,period:r.period_start,payday:r.payday,benefitMonth:r.benefit_month,classification:r.classification,amounts:{sss:r.sss,philhealth:r.philhealth,pagibig:r.pagibig}}));
 // "Paid" = included in approved (locked) payroll; agency remittance is not tracked here.
 const monthTotal=allocations.reduce((n,a)=>{for(const k of BENEFITS){n+=a.amounts[k];}if(!Number.isSafeInteger(n))throw new Error('Invalid contribution total');return n;},0);
 const [all]=await tx`select count(*)::int as count,coalesce(sum(c.sss+c.philhealth+c.pagibig),0)::bigint as total from payroll_contributions c join payroll_runs r on r.id=c.run_id where r.status='locked'`;
 const paid={month:{count:allocations.length,total:monthTotal},allTime:{count:all.count as number,total:all.total as number}};
 return {employees,allocations,totals,paid};
}
