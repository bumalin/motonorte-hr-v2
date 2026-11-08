import {BENEFITS,type BenefitAmounts,type ContributionInput,type ContributionAllocation} from './types.ts';
const monthOf=(d:string)=>d.slice(0,7)+'-01';
export function nextMonth(month:string):string{const d=new Date(month+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);return d.toISOString().slice(0,10);}
export function benefitEligibilityMonth(hireDate:string,rolloutMonth:string):string{const m=monthOf(hireDate);return [rolloutMonth,Number(hireDate.slice(8))<=5?m:nextMonth(m)].sort().at(-1)!;}
export function monthPaydays(month:string):string[]{const d=new Date(monthOf(month)+'T00:00:00Z');const m=d.getUTCMonth();d.setUTCDate(1+(7-d.getUTCDay())%7);const days:string[]=[];while(d.getUTCMonth()===m){days.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+7);}return days;}
function checked(n:number):number{if(!Number.isSafeInteger(n)||n<0)throw new Error('Invalid contribution amount');return n;}
export function calculateContributions(input:ContributionInput):ContributionAllocation[]{
 const {hireDate,endDate,periodStart,payday}=input;
 if(hireDate>payday||(endDate&&endDate<periodStart))return [];
 const final=!!endDate&&endDate>=periodStart&&endDate<=payday;
 const benefitMonth=monthOf(final?endDate!:payday);
 if(benefitMonth<benefitEligibilityMonth(hireDate,input.rolloutMonth))return [];
 const term=[...input.terms].filter(t=>t.effectiveMonth<=benefitMonth).sort((a,b)=>b.effectiveMonth.localeCompare(a.effectiveMonth))[0];
 if(!term)return [];
 const paydays=monthPaydays(benefitMonth),index=paydays.indexOf(payday);
 const prior=input.approved.filter(a=>a.benefitMonth===benefitMonth);
 if(prior.some(a=>a.payday>payday))throw new Error('Contribution backfill would affect later approved allocation');
 const missed=paydays.filter(p=>p<hireDate);
 const firstEligible=paydays.find(p=>p>=hireDate);
 const catchup=!final&&payday===firstEligible&&missed.length>0;
 const amounts={} as BenefitAmounts;
 for(const key of BENEFITS){const monthly=checked(term.amounts[key]);const used=prior.reduce((s,a)=>checked(s+checked(a.amounts[key])),0);
  const share=(i:number)=>Math.floor(monthly/paydays.length)+(i<monthly%paydays.length?1:0);
  const allocation=final?monthly-used:share(index)+(catchup?missed.reduce((s,p)=>s+share(paydays.indexOf(p)),0):0);
  if(index<0&&!final)throw new Error('Invalid Sunday payday');
  amounts[key]=checked(allocation);if(used+allocation>monthly)throw new Error('Contribution exceeds monthly entitlement');
 }
 return [{employeeId:input.employeeId,benefitMonth,amounts,monthly:{...term.amounts},classification:final?'final_settlement':catchup?'joining_catchup':'ordinary',provenance:{version:1,termId:term.id,hireDate,endDate,payday,paydays}}];
}
