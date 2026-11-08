// Regression tests for the 2026-11-08 review fixes. Disposable motonorte_integrity_test database only; every test rolls back.
import test from 'node:test';import assert from 'node:assert/strict';import postgres from 'postgres';import {randomUUID} from 'node:crypto';
import {requireDisposableDatabase} from '../db/testSafety.ts';import {PG_TYPES} from '../db/client.ts';import {canonicalJson} from '../payroll/hash.ts';
import {loadContributionInputs,databaseAllocations} from './data.ts';import {calculateContributions,monthPaydays} from './calculate.ts';
const url=process.env.DATABASE_URL_OWNER?requireDisposableDatabase(process.env.DATABASE_URL_OWNER,'motonorte_integrity_test'):undefined;
const mondayBefore=(sunday:string)=>new Date(new Date(sunday+'T00:00:00Z').getTime()-6*86400000).toISOString().slice(0,10);
const line=(employee_id:string)=>({employee_id,basic:10000,base:10000,ot:0,incentive:0,allowances:0,deductions:0,carried_in:0,gross:10000,net:10000,carry_out:0});
async function clearRuns(tx:postgres.TransactionSql){await tx`set local session_replication_role=replica`;for(const t of ['payroll_contributions','payroll_payments','payslip_requests','payroll_run_versions','payroll_items','payroll_lines','payroll_runs'])await tx.unsafe('delete from '+t);await tx`set local session_replication_role=origin`;}

test('locking an earlier week does not change a later draft week\'s contribution inputs (no spurious RUN_STALE)',{skip:!url&&'Disposable DB required'},async()=>{
 const sql=postgres(url!,{max:1,types:PG_TYPES});try{await sql.begin(async tx=>{await clearRuns(tx);
 const owner=randomUUID(),employee=randomUUID();
 await tx`insert into users(id,email,full_name,password_hash,role) values(${owner},${owner+'@review.test'},'Owner','x','owner')`;
 await tx`insert into employees(id,code,full_name,rest_day,hire_date) values(${employee},'RV001','Review employee','sun','2025-01-01')`;
 await tx`select set_config('app.user_id',${owner},true)`;
 await tx`insert into employee_contribution_terms(employee_id,effective_month,sss,philhealth,pagibig) values(${employee},'2034-11-01',100001,60000,20000)`;
 const [p1,p2]=monthPaydays('2034-11-01'),w1=mondayBefore(p1),w2=mondayBefore(p2);
 const before=canonicalJson(await loadContributionInputs(tx,w2));
 const alloc=(await loadContributionInputs(tx,w1)).flatMap(calculateContributions);
 const [{id}]=await tx`select save_draft_with_contributions(${w1},'w1','{}',${JSON.stringify([line(employee)])}::text::jsonb,'[]',${JSON.stringify(databaseAllocations(alloc))}::text::jsonb) as id`;
 await tx`select submit_run(${id})`;await tx`select lock_run(${id},'w1')`;
 assert.equal(canonicalJson(await loadContributionInputs(tx,w2)),before,'locking week 1 must not alter week 2 inputs');
 // Week 2 still validates against the authoritative SQL allocation (which does see week 1).
 const later=(await loadContributionInputs(tx,w2)).flatMap(calculateContributions);
 const [{id:id2}]=await tx`select save_draft_with_contributions(${w2},'w2','{}',${JSON.stringify([line(employee)])}::text::jsonb,'[]',${JSON.stringify(databaseAllocations(later))}::text::jsonb) as id`;
 assert.ok(id2);
 throw new Error('ROLLBACK');}).catch(e=>{if(e.message!=='ROLLBACK')throw e;});}finally{await sql.end();}
});

test('first-time contribution setup skips a month that already has a submitted week',{skip:!url&&'Disposable DB required'},async()=>{
 const sql=postgres(url!,{max:1,types:PG_TYPES});try{await sql.begin(async tx=>{await clearRuns(tx);
 const owner=randomUUID(),employee=randomUUID();
 await tx`insert into users(id,email,full_name,password_hash,role) values(${owner},${owner+'@review.test'},'Owner','x','owner')`;
 await tx`insert into employees(id,code,full_name,rest_day,hire_date) values(${employee},'RV002','Submitted employee','sun','2025-01-01')`;
 await tx`select set_config('app.user_id',${owner},true)`;
 const [{m}]=await tx`select greatest(date_trunc('month',now() at time zone 'Asia/Manila')::date,'2026-11-01'::date)::text as m`;
 const start=mondayBefore(monthPaydays(m)[0]);
 const [{id}]=await tx`select save_draft(${start},'sub','{}',${JSON.stringify([line(employee)])}::text::jsonb,'[]') as id`;
 await tx`select submit_run(${id})`;
 const [{month}]=await tx`select set_employee_contributions(${employee},1000,1000,1000)::text as month`;
 assert.ok(month>m,`expected a month after ${m}, got ${month}`);
 throw new Error('ROLLBACK');}).catch(e=>{if(e.message!=='ROLLBACK')throw e;});}finally{await sql.end();}
});
