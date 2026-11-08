import test from 'node:test';import assert from 'node:assert/strict';import postgres from 'postgres';import {randomUUID} from 'node:crypto';
import {requireDisposableDatabase} from '../db/testSafety.ts';import {PG_TYPES} from '../db/client.ts';
import {loadContributionInputs,databaseAllocations} from './data.ts';import {calculateContributions,monthPaydays} from './calculate.ts';import {contributionReport} from './reports.ts';import {documentSnapshot} from '../portal/data.ts';
const url=process.env.DATABASE_URL_OWNER?requireDisposableDatabase(process.env.DATABASE_URL_OWNER,'motonorte_integrity_test'):undefined;
test('contribution schema owner writes, monthly allocation and frozen approval safeguards',{skip:!url&&'Disposable DB required'},async()=>{
 const sql=postgres(url!,{max:1,types:PG_TYPES});try{await sql.begin(async tx=>{
 const owner=randomUUID(),employee=randomUUID();
 await tx`insert into users(id,email,full_name,password_hash,role) values(${owner},${owner+'@contributions.test'},'Benefit test owner','x','owner')`;
 await tx`insert into employees(id,code,full_name,rest_day,hire_date) values(${employee},'BT001','Benefit test employee','sun','2025-01-01')`;
 await tx`select set_config('app.user_id',${owner},true)`;
 await tx`select set_employee_contributions(${employee},100001,60000,20000)`;
 const [term]=await tx`select effective_month::text from employee_contribution_terms where employee_id=${employee}`;
 assert.ok(term.effective_month.endsWith('-01'));
 const [r]=await tx`select * from expected_contributions(${term.effective_month}::date + ((7-extract(dow from ${term.effective_month}::date)::int)%7)-6,null) where employee_id=${employee}`;
 assert.ok(r);assert.equal(r.sss,Math.floor(100001/r.payday_count)+(100001%r.payday_count>0?1:0));
 await tx`select set_config('app.user_id','',true)`;
 await assert.rejects(()=>tx.savepoint(s=>s`select set_employee_contributions(${employee},1,1,1)`),/FORBIDDEN/);
 throw new Error('ROLLBACK');}).catch(e=>{if(e.message!=='ROLLBACK')throw e;});}finally{await sql.end();}
});
test('new draft saves authoritative allocations; approval freezes employer values without altering net; report, crew RLS and reopen reconcile',{skip:!url&&'Disposable DB required'},async()=>{
 const sql=postgres(url!,{max:1,types:PG_TYPES});try{await sql.begin(async tx=>{
 // Exact disposable DB is verified above. Clear synthetic runs only inside this rollback transaction.
 await tx`set local session_replication_role=replica`;
 for(const table of ['payroll_contributions','payroll_payments','payslip_requests','payroll_run_versions','payroll_items','payroll_lines','payroll_runs'])await tx.unsafe('delete from '+table);
 await tx`set local session_replication_role=origin`;
 const owner=randomUUID(),employee=randomUUID(),crew=randomUUID(),staff=randomUUID(),unknown=randomUUID();
 await tx`insert into users(id,email,full_name,password_hash,role) values(${owner},${owner+'@contributions.test'},'Benefits owner','x','owner'),(${staff},${staff+'@contributions.test'},'Benefits staff','x','staff')`;
 await tx`insert into employees(id,code,full_name,rest_day,hire_date) values(${employee},'CT001','Benefits employee','sun','2025-01-01')`;
 await tx`insert into employees(id,code,full_name,rest_day,hire_date) values(${unknown},'CT002','Unconfigured employee','sun','2025-01-01')`;
 await tx`insert into users(id,email,full_name,password_hash,role,access_kind,employee_id,tabs) values(${crew},${crew+'@contributions.test'},'Benefits crew','x','staff','crew',${employee},array['mypay','payslips'])`;
 await tx`select set_config('app.user_id',${owner},true)`;
 await tx`select set_employee_contributions(${employee},100001,60000,20000)`;
 const sunday=monthPaydays('2034-11-01')[0],start=new Date(new Date(sunday+'T00:00:00Z').getTime()-6*86400000).toISOString().slice(0,10);
 const inputs=await loadContributionInputs(tx,start);const c=inputs.flatMap(calculateContributions);const saved=databaseAllocations(c);
 assert.equal(c.length,1);
 const line=[{employee_id:employee,basic:10000,base:10000,ot:0,incentive:0,allowances:0,deductions:0,carried_in:0,gross:10000,net:10000,carry_out:0}];
 line.push({...line[0],employee_id:unknown});
 await assert.rejects(()=>tx.savepoint(s=>s`select save_draft_with_contributions(${start},'qa','{}',${JSON.stringify(line)}::text::jsonb,'[]','[]')`),/CONTRIBUTION_RUN_STALE/);
 const [{id}]=await tx`select save_draft_with_contributions(${start},'qa','{}',${JSON.stringify(line)}::text::jsonb,'[]',${JSON.stringify(saved)}::text::jsonb) as id`;
 await tx`select submit_run(${id})`;await tx`select lock_run(${id},'qa')`;
 assert.equal((await tx`select net from payroll_lines where run_id=${id}`)[0].net,10000);
 await assert.rejects(()=>tx.savepoint(s=>s`update payroll_contributions set sss=1 where run_id=${id}`),/LOCKED/);
 const report=await contributionReport(tx,'2034-11-01');assert.equal(report.totals.approved.sss,c[0].amounts.sss);assert.equal(report.totals.planned.sss,100001);
 const paidTotal=c[0].amounts.sss+c[0].amounts.philhealth+c[0].amounts.pagibig;assert.deepEqual(report.paid,{month:{count:1,total:paidTotal},allTime:{count:1,total:paidTotal}},'paid cards count approved allocations');
 const snapshot=await documentSnapshot(tx,employee,'2034-11-01','2034-11-30');assert.deepEqual(snapshot.weeks[0].contributions,c);
 const [request]=await tx`insert into payslip_requests(employee_id,range_start,range_end) values(${employee},'2034-11-01','2034-11-30') returning id`;
 const missing=structuredClone(snapshot);delete missing.weeks[0].contributions;
 await assert.rejects(()=>tx.savepoint(s=>s`select review_payslip(${request.id},true,'QA invalid',${JSON.stringify(missing)}::text::jsonb)`),/CONTRIBUTION_SNAPSHOT_INVALID/);
 await tx`select review_payslip(${request.id},true,'QA valid',${JSON.stringify(snapshot)}::text::jsonb)`;
 const unknownSnapshot=await documentSnapshot(tx,unknown,'2034-11-01','2034-11-30');assert.equal(unknownSnapshot.weeks[0].contributions,null,'unconfigured employee must not become a recorded zero');
 await tx`set local role app_user`;await tx`select set_config('app.user_id',${crew},true)`;
 assert.equal((await tx`select * from payroll_contributions`).length,1);assert.equal((await tx`select app_role() as role`)[0].role,null);
 await assert.rejects(()=>tx.savepoint(s=>s`select set_employee_contributions(${employee},1,1,1)`),/FORBIDDEN/);
 await tx`select set_config('app.user_id',${staff},true)`;await assert.rejects(()=>tx.savepoint(s=>s`select set_employee_contributions(${employee},1,1,1)`),/FORBIDDEN/);
 await tx`reset role`;await tx`select set_config('app.user_id',${owner},true)`;
 await tx`update employees set end_date='2034-11-30' where id=${employee}`;
 const finalSunday=monthPaydays('2034-12-01')[0],finalStart=new Date(new Date(finalSunday+'T00:00:00Z').getTime()-6*86400000).toISOString().slice(0,10);
 const final=(await loadContributionInputs(tx,finalStart)).flatMap(calculateContributions);assert.equal(final[0].benefitMonth,'2034-11-01');
 const [expectedFinal]=await tx`select * from expected_contributions(${finalStart}::date,null) where employee_id=${employee}`;assert.equal(expectedFinal.sss,final[0].amounts.sss);
 const [{id:finalId}]=await tx`select save_draft_with_contributions(${finalStart},'final','{}',${JSON.stringify(line)}::text::jsonb,'[]',${JSON.stringify(databaseAllocations(final))}::text::jsonb) as id`;
 await tx`select submit_run(${finalId})`;await tx`select lock_run(${finalId},'final')`;
 assert.equal((await contributionReport(tx,'2034-11-01')).totals.approved.sss,100001);assert.equal((await contributionReport(tx,'2034-12-01')).totals.approved.sss,0);
 await assert.rejects(()=>tx.savepoint(s=>s`update employees set end_date='2034-11-29' where id=${employee}`),/CONTRIBUTION_EMPLOYMENT_FROZEN/);
 await tx`select unlock_run(${finalId},'Synthetic final correction')`;
 await tx`select unlock_run(${id},'Synthetic correction')`;
 assert.equal((await contributionReport(tx,'2034-11-01')).totals.approved.sss,0);
 assert.equal((await tx`select snapshot->'contributions' as contributions from payroll_run_versions where run_id=${id}`)[0].contributions.length,1);
 throw new Error('ROLLBACK');}).catch(e=>{if(e.message!=='ROLLBACK')throw e;});}finally{await sql.end();}
});
test('future-hire pending edits replace initial schedule rather than being superseded',{skip:!url&&'Disposable DB required'},async()=>{
 const sql=postgres(url!,{max:1,types:PG_TYPES});try{await sql.begin(async tx=>{
 const owner=randomUUID(),employee=randomUUID();await tx`insert into users(id,email,full_name,password_hash,role) values(${owner},${owner+'@benefits.test'},'Owner','x','owner')`;
 await tx`insert into employees(id,code,full_name,rest_day,hire_date) values(${employee},'FT001','Future employee','sun','2040-12-06')`;await tx`select set_config('app.user_id',${owner},true)`;
 const [first]=await tx`select set_employee_contributions(${employee},10000,10000,10000)::text as month`;await tx`select set_employee_contributions(${employee},20000,20000,20000)`;
 const terms=await tx`select effective_month::text,sss from employee_contribution_terms where employee_id=${employee}`;assert.equal(terms.length,1);assert.equal(terms[0].effective_month,first.month);assert.equal(terms[0].sss,20000);
 throw new Error('ROLLBACK');}).catch(e=>{if(e.message!=='ROLLBACK')throw e;});}finally{await sql.end();}
});
test('old-image approval with absent benefit property is allowed only for legacy runs',{skip:!url&&'Disposable DB required'},async()=>{
 const sql=postgres(url!,{max:1,types:PG_TYPES});try{await sql.begin(async tx=>{
 await tx`set local session_replication_role=replica`;for(const table of ['payroll_contributions','payroll_payments','payslip_requests','payroll_run_versions','payroll_items','payroll_lines','payroll_runs'])await tx.unsafe('delete from '+table);await tx`set local session_replication_role=origin`;
 const owner=randomUUID(),employee=randomUUID();await tx`insert into users(id,email,full_name,password_hash,role) values(${owner},${owner+'@benefits.test'},'Owner','x','owner')`;await tx`insert into employees(id,code,full_name,rest_day,hire_date) values(${employee},'LG001','Legacy employee','sun','2025-01-01')`;await tx`select set_config('app.user_id',${owner},true)`;
 const lines=[{employee_id:employee,basic:10000,base:10000,ot:0,incentive:0,allowances:0,deductions:0,carried_in:0,gross:10000,net:10000,carry_out:0}];const [{id}]=await tx`select save_draft('2035-01-01','legacy','{}',${JSON.stringify(lines)}::text::jsonb,'[]') as id`;await tx`select submit_run(${id})`;await tx`select lock_run(${id},'legacy')`;
 const snapshot=await documentSnapshot(tx,employee,'2035-01-01','2035-01-31');for(const week of snapshot.weeks){delete week.contributions;}
 const [req]=await tx`insert into payslip_requests(employee_id,range_start,range_end) values(${employee},'2035-01-01','2035-01-31') returning id`;
 await tx`select review_payslip(${req.id},true,'QA legacy',${JSON.stringify(snapshot)}::text::jsonb)`;assert.equal((await tx`select status from payslip_requests where id=${req.id}`)[0].status,'approved');
 throw new Error('ROLLBACK');}).catch(e=>{if(e.message!=='ROLLBACK')throw e;});}finally{await sql.end();}
});
