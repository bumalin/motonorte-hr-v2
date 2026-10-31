import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {withUser,PG_TYPES} from './client.ts';
import {loadPeriodInput} from './loadPeriodInput.ts';
import {computeWeek} from '../payroll/engine.ts';
import {inputHash} from '../payroll/hash.ts';

// These tests commit coordinated transactions. NEVER run on a live database.
const url=process.env.DATABASE_URL_OWNER;
const isolated=!!url && new URL(url).pathname==='/motonorte_integrity_test'
 && !!process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname==='/motonorte_integrity_test';
test('admin-only attendance; approval serializes with edits; reopened calculations remain immutable',
 {skip:!isolated && 'Requires the disposable motonorte_integrity_test database'},async()=>{
 const admin=postgres(url!,{max:1,types:PG_TYPES});
 let release:()=>void=()=>{};
 try{
  const [owner]=await admin`insert into users(email,full_name,password_hash,role) values(${randomUUID()+'@integrity.invalid'},'Synthetic owner','x','owner') returning id`;
  const [staff]=await admin`insert into users(email,full_name,password_hash,role) values(${randomUUID()+'@integrity.invalid'},'Synthetic staff','x','staff') returning id`;
  const week='2026-10-05';const employee='00000000-0000-0000-0000-00000000a001';
  for(const op of ['insert','update','delete'])await assert.rejects(()=>withUser(staff.id,async tx=>{
   if(op==='insert')await tx`insert into attendance(employee_id,date,status) values(${employee},'2026-11-02','F')`;
   if(op==='update')await tx`update attendance set status='H' where employee_id=${employee} and date=${week}`;
   if(op==='delete')await tx`delete from attendance where employee_id=${employee} and date=${week}`;
  }),/ATTENDANCE_ADMIN_ONLY/);
  const draft=()=>withUser(owner.id,async tx=>{
   const input=await loadPeriodInput(tx,week);const pay=computeWeek(input);assert.equal(pay.ok,true);if(!pay.ok)throw new Error('Incomplete fixture');
   const lines=pay.lines.map(l=>({employee_id:l.employeeId,basic:l.basic,base:l.base,ot:l.ot,incentive:l.incentive,allowances:l.allowances,deductions:l.deductions,carried_in:l.carriedIn,gross:l.gross,net:l.net,carry_out:l.carryOut}));
   const [run]=await tx`select save_draft(${week},${inputHash(input)},'{}'::jsonb,${JSON.stringify(lines)}::text::jsonb,'[]'::jsonb) as id`;return run.id as string;
  });
  await withUser(owner.id,async tx=>{const [r]=await tx`select id,status from payroll_runs where period_start=${week}`;if(r?.status==='locked')await tx`select unlock_run(${r.id},'Synthetic repeat setup')`;if(r?.status==='submitted')await tx`select send_back_run(${r.id},'Synthetic repeat setup')`;await tx`update attendance set status='F' where employee_id=${employee} and date=${week}`});
  const run=await draft();
  const waitForBlocked=async()=>{const deadline=Date.now()+5000;while(Date.now()<deadline){const [r]=await admin`select exists(select 1 from pg_locks where locktype='advisory' and objid=76239146 and not granted) as waiting`;if(r.waiting)return;await new Promise(r=>setTimeout(r,20))}throw new Error('Expected transaction to wait on payroll lock')};
  let ready:()=>void=()=>{};const staged=new Promise<void>(r=>ready=r);const permit=new Promise<void>(r=>release=r);
  const edit=withUser(owner.id,async tx=>{await tx`update attendance set status='H' where employee_id=${employee} and date=${week}`;ready();await permit});
  await staged;
  const submit=withUser(staff.id,async tx=>{
   const [r]=await tx`select input_hash from payroll_runs where id=${run}`;
   if(inputHash(await loadPeriodInput(tx,week))!==r.input_hash)throw new Error('RUN_STALE');
   await tx`select submit_run(${run})`;
  }).then(()=>null,e=>e as Error);
  await waitForBlocked();release();await edit;assert.match((await submit)!.message,/RUN_STALE/);
  assert.equal((await admin`select status from payroll_runs where id=${run}`)[0].status,'draft');
  await draft();
  let approved:()=>void=()=>{};const locked=new Promise<void>(r=>approved=r);const commitApproval=new Promise<void>(r=>release=r);
  const approve=withUser(owner.id,async tx=>{
   await tx`select submit_run(${run})`;await tx`select lock_run(${run},${inputHash(await loadPeriodInput(tx,week))})`;approved();await commitApproval;
  });
  await locked;
  const lateEdit=withUser(owner.id,tx=>tx`update attendance set status='A' where employee_id=${employee} and date=${week}`).then(()=>null,e=>e as Error);
  await waitForBlocked();release();await approve;assert.match((await lateEdit)!.message,/PERIOD_LOCKED/);
  assert.equal((await admin`select status from attendance where employee_id=${employee} and date=${week}`)[0].status,'H');
  const [original]=await admin`select to_jsonb(r) as run from payroll_runs r where id=${run}`;
  await withUser(owner.id,tx=>tx`select unlock_run(${run},'Synthetic correction test')`);
  const [version]=await admin`select snapshot from payroll_run_versions where run_id=${run} order by id desc limit 1`;
  assert.deepEqual(version.snapshot.run,original.run);
  assert.ok(version.snapshot.lines.length>0);
  await withUser(owner.id,tx=>tx`update attendance set status='F' where employee_id=${employee} and date=${week}`);
  await draft();
  assert.deepEqual((await admin`select snapshot from payroll_run_versions where run_id=${run} order by id desc limit 1`)[0].snapshot,version.snapshot);
  await assert.rejects(()=>withUser(owner.id,tx=>tx`update payroll_run_versions set reason='tamper' where run_id=${run}`),/permission denied/);
  await assert.rejects(()=>admin`delete from payroll_run_versions where run_id=${run}`,/IMMUTABLE_PAYROLL_VERSION/);
 }finally{release();await admin.end();await (globalThis as unknown as {__mnSql?:ReturnType<typeof postgres>}).__mnSql?.end({timeout:1})}
});
