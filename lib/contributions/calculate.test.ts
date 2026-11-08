import test from 'node:test';import assert from 'node:assert/strict';
import {calculateContributions,monthPaydays,benefitEligibilityMonth} from './calculate.ts';
const input={employeeId:'e',hireDate:'2025-01-01',endDate:null,periodStart:'2026-10-05',payday:'2026-10-11',rolloutMonth:'2026-10-01',terms:[{id:'t',effectiveMonth:'2026-10-01',amounts:{sss:100001,philhealth:60000,pagibig:20000}}],approved:[]};
test('Sunday schedule, centavo conservation, month boundaries and eligibility cutoff',()=>{
 assert.equal(monthPaydays('2026-10-01').length,4);assert.equal(monthPaydays('2026-11-01').length,5);
 assert.equal(benefitEligibilityMonth('2026-10-05','2026-10-01'),'2026-10-01');assert.equal(benefitEligibilityMonth('2026-10-06','2026-10-01'),'2026-11-01');
 const shares=monthPaydays('2026-10-01').map(payday=>calculateContributions({...input,payday,periodStart:new Date(new Date(payday+'T00:00:00Z').getTime()-6*86400000).toISOString().slice(0,10)})[0].amounts.sss);
 assert.deepEqual(shares,[25001,25000,25000,25000]);assert.equal(shares.reduce((a,b)=>a+b,0),100001);
});
test('early joining catches missed Sunday; late joining has no current entitlement',()=>{
 assert.equal(calculateContributions({...input,hireDate:'2026-10-05'})[0].amounts.sss,50001);
 assert.deepEqual(calculateContributions({...input,hireDate:'2026-10-06'}),[]);
});
test('final payroll records remaining full month, retaining benefit month across payday boundary',()=>{
 const end={...input,endDate:'2026-10-15',periodStart:'2026-10-12',payday:'2026-10-18',approved:[{runId:'r',payday:'2026-10-11',benefitMonth:'2026-10-01',amounts:{sss:50001,philhealth:30000,pagibig:10000}}]};
 assert.equal(calculateContributions(end)[0].amounts.sss,50000);
 const final=calculateContributions({...input,endDate:'2026-10-31',periodStart:'2026-10-26',payday:'2026-11-01'});
 assert.equal(final[0].benefitMonth,'2026-10-01');assert.equal(final[0].classification,'final_settlement');assert.equal(final[0].amounts.sss,100001);
});
test('legacy unknown, explicit zero, unsafe values and late backfill cannot invent allocation',()=>{
 assert.deepEqual(calculateContributions({...input,terms:[]}),[]);
 assert.equal(calculateContributions({...input,terms:[{...input.terms[0],amounts:{sss:0,philhealth:0,pagibig:0}}]})[0].amounts.sss,0);
 assert.throws(()=>calculateContributions({...input,terms:[{...input.terms[0],amounts:{sss:Number.MAX_SAFE_INTEGER+1,philhealth:0,pagibig:0}}]}),/amount/i);
 assert.throws(()=>calculateContributions({...input,approved:[{runId:'later',payday:'2026-10-18',benefitMonth:'2026-10-01',amounts:{sss:50001,philhealth:0,pagibig:0}}]}),/backfill/i);
});
