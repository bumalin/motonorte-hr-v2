import test from 'node:test';import assert from 'node:assert/strict';import {payslipPdf} from '../portal/pdf.ts';import type {PayWeek} from '../portal/types.ts';
test('recorded employer benefits have an additional monthly summary while old slips stay readable',async()=>{
 const week:PayWeek={runId:'qa',version:'2026-11-02',period:'2026-10-26',end:'2026-11-01',payday:'2026-11-01',status:'locked',basic:10000,base:10000,ot:0,incentive:0,allowances:0,deductions:0,carriedIn:0,carryOut:0,gross:10000,net:10000,paid:0,paidOn:null,items:[],contributions:[{employeeId:'qa',benefitMonth:'2026-11-01',amounts:{sss:20000,philhealth:12000,pagibig:4000},monthly:{sss:100000,philhealth:60000,pagibig:20000},classification:'ordinary',provenance:{}}]};
 const snapshot={employeeId:'qa',name:'Synthetic employee',code:'Q001',rangeStart:'2026-11-01',rangeEnd:'2026-11-30',weeks:[week]};
 const pdf=await payslipPdf(snapshot,'qa');assert.ok(pdf.toString().includes('/Count 3'));assert.equal(week.net,10000);
 const old=await payslipPdf({...snapshot,weeks:[{...week,contributions:null}]},'old');assert.ok(old.toString().includes('/Count 2'));
});
