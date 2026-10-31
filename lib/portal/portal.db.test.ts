import test from "node:test";import assert from "node:assert/strict";import postgres from "postgres";import {randomUUID} from "node:crypto";import {withUser,withAnon,PG_TYPES} from "../db/client.ts";import {documentSnapshot} from "./data.ts";import {hashToken} from "../auth/token.ts";import {payslipPdf} from "./pdf.ts";
const url=process.env.DATABASE_URL_OWNER;
const isolated=!!url&&new URL(url).pathname==="/motonorte_integrity_test"&&!!process.env.DATABASE_URL&&new URL(process.env.DATABASE_URL).pathname==="/motonorte_integrity_test";
test("crew activation, row privacy, payments, immutable range approval and atomic one-use PDF",{skip:!isolated&&"Disposable database required"},async()=>{
 const admin=postgres(url!,{max:1,types:PG_TYPES});let crew="";
 try{
 const id=randomUUID(),other=randomUUID(),owner=randomUUID(),email=randomUUID()+"@portal.invalid",hash=hashToken("synthetic-activation-code");
 await admin`insert into users(id,email,full_name,password_hash,role) values(${owner},${randomUUID()+"@portal.invalid"},'Portal QA owner','x','owner')`;
 await admin`insert into employees(id,code,full_name,rest_day,hire_date) values(${id},${"QP"+String(Math.floor(Math.random()*900)+100)},'Portal QA employee','sun','2025-01-01'),(${other},${"QR"+String(Math.floor(Math.random()*900)+100)},'Other QA employee','sun','2025-01-01')`;
 const [newCrew]=await withUser(owner,tx=>tx`insert into users(email,full_name,password_hash,role,access_kind,employee_id,active,tabs,activation_hash,activation_expires_at) values(${email},'Portal QA employee','x','staff','crew',${id},false,array['profile','mypay','payslips'],${hash},now()+interval '1 day') returning id`);crew=newCrew.id;
 const wrong=await withAnon(tx=>tx`select activate_crew(${email},'wrong','new-test-hash') as id`);assert.equal(wrong[0].id,null);
 const activation=await withAnon(tx=>tx`select activate_crew(${email},${hash},'new-test-hash') as id`);assert.equal(activation[0].id,crew);
 const reused=await withAnon(tx=>tx`select activate_crew(${email},${hash},'next-test-hash') as id`);assert.equal(reused[0].id,null);
 const employees=await withUser(crew,tx=>tx`select id from employees`);assert.deepEqual(employees.map(e=>e.id),[id]);
 const [{role}]=await withUser(crew,tx=>tx`select app_role() as role`);assert.equal(role,null);
 const [{n}]=await withUser(crew,tx=>tx`select count(*)::int as n from payroll_run_versions`);assert.equal(n,0);
 await assert.rejects(()=>withUser(crew,tx=>tx`select save_draft('2032-01-05','x','{}','[]','[]')`),/FORBIDDEN/);
 await assert.rejects(()=>withUser(crew,tx=>tx`insert into employees(code,full_name,rest_day,hire_date) values('QA999','Forbidden','sun','2025-01-01')`),/row-level security/);
  const run=await withUser(owner,async tx=>{
 const earlier=await tx`select id,status,input_hash from payroll_runs where status<>'locked' and period_start<'2032-01-05' order by period_start`;
 for(const r of earlier){if(r.status==='draft')await tx`select submit_run(${r.id})`;await tx`select lock_run(${r.id},${r.input_hash})`;}
 const lines=[id,other].map(employee_id=>({employee_id,basic:10000,base:10000,ot:0,incentive:0,allowances:0,deductions:0,carried_in:0,gross:10000,net:10000,carry_out:0}));
 const [{id:runId}]=await tx`select save_draft('2032-01-05','portal-hash','{}',${JSON.stringify(lines)}::text::jsonb,'[]') as id`;
 await tx`select submit_run(${runId})`;await tx`select lock_run(${runId},'portal-hash')`;return runId;});
 const lines=await withUser(crew,tx=>tx`select employee_id from payroll_lines`);assert.deepEqual(lines.map(l=>l.employee_id),[id]);
 const otherTerms=await withUser(crew,tx=>tx`select * from pay_terms where employee_id=${other}`);assert.equal(otherTerms.length,0);
 await assert.rejects(()=>withUser(crew,tx=>tx`select record_payroll_payment(${run},${id},10000,'2026-10-10','Cash','QA')`),/FORBIDDEN/);
 await withUser(owner,tx=>tx`select record_payroll_payment(${run},${id},10000,'2026-10-10','Cash','QA')`);
 await assert.rejects(()=>withUser(owner,tx=>tx`select record_payroll_payment(${run},${id},1,'2026-10-10','Cash','QA')`),/PAYMENT_EXCEEDS_BALANCE/);
 const request=await withUser(crew,async tx=>{const [r]=await tx`insert into payslip_requests(employee_id,range_start,range_end) values(${id},'2032-01-01','2032-01-31') returning id`;return r.id;});
 await assert.rejects(()=>withUser(crew,tx=>tx`insert into payslip_requests(employee_id,range_start,range_end) values(${other},'2032-01-01','2032-01-31')`),/row-level security/);
 await assert.rejects(()=>withUser(crew,tx=>tx`select review_payslip(${request},false,'reject',null)`),/FORBIDDEN/);
 await assert.rejects(()=>withUser(crew,tx=>tx`select consume_payslip(${request})`),/DOWNLOAD_UNAVAILABLE/);
 await withUser(owner,async tx=>{const snapshot=await documentSnapshot(tx,id,'2032-01-01','2032-01-31');assert.equal(snapshot.weeks[0].paid,10000);assert.ok((await payslipPdf(snapshot,request)).subarray(0,8).toString().startsWith("%PDF-1.4"));await tx`select review_payslip(${request},true,'QA approved',${JSON.stringify(snapshot)}::text::jsonb)`;});
 await withUser(owner,tx=>tx`update employees set full_name='Changed after approval' where id=${id}`);
 const results=await Promise.allSettled([withUser(crew,tx=>tx`select consume_payslip(${request}) as snapshot`),withUser(crew,tx=>tx`select consume_payslip(${request}) as snapshot`)]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(results.filter(r=>r.status==="rejected").length,1);
 const success=results.find(r=>r.status==="fulfilled");assert.ok(success?.status==="fulfilled");assert.equal(success.value[0].snapshot.name,"Portal QA employee");
 const req2=await withUser(crew,async tx=>{const[r]=await tx`insert into payslip_requests(employee_id,range_start,range_end) values(${id},'2032-01-01','2032-01-31') returning id`;return r.id;});
 await withUser(owner,async tx=>{const s=await documentSnapshot(tx,id,'2032-01-01','2032-01-31');await tx`select review_payslip(${req2},true,'',${JSON.stringify(s)}::text::jsonb)`;});
 await withUser(owner,tx=>tx`select unlock_run(${run},'QA correction')`);
 const [revoked]=await withUser(crew,tx=>tx`select status from payslip_requests where id=${req2}`);assert.equal(revoked.status,"revoked");
 await assert.rejects(()=>withUser(crew,tx=>tx`select consume_payslip(${req2})`),/DOWNLOAD_UNAVAILABLE/);
 const [{secret}]=await admin`select count(*)::int as secret from audit_log where table_name='users' and (new ? 'activation_hash' or old ? 'activation_hash')`;assert.equal(secret,0);
 }finally{await admin.end();const g=globalThis as unknown as {__mnSql?:postgres.Sql};if(g.__mnSql){await g.__mnSql.end();delete g.__mnSql;}}
});
