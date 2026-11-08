import {BENEFITS,type ContributionAllocation} from './types.ts';
export function summarizeContributions(weeks:{contributions?:ContributionAllocation[]|null}[]){
 const totals={sss:0,philhealth:0,pagibig:0};const months=new Set<string>();let recordedWeeks=0;
 for(const week of weeks){if(week.contributions==null)continue;recordedWeeks++;
  for(const c of week.contributions){months.add(c.benefitMonth);for(const key of BENEFITS){const n=c.amounts[key];if(!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(totals[key]+n))throw new Error('Invalid contribution amount');totals[key]+=n;}}
 }
 const total=totals.sss+totals.philhealth+totals.pagibig;if(!Number.isSafeInteger(total))throw new Error('Invalid contribution amount');
 return {...totals,total,recordedWeeks,missingWeeks:weeks.length-recordedWeeks,benefitMonths:[...months].sort()};
}
