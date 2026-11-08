import {test,expect} from '@playwright/test';import {e2eSql,login} from './helpers.ts';import {hashPassword} from '../../lib/auth/password.ts';
import {writeFileSync} from 'node:fs';
const employee='00000000-0000-0000-0000-00000000a001';
test('owner configures recurring employer totals, report exports, staff and crew boundaries, mobile layout',async({browser})=>{
 const owner=await (await browser.newContext()).newPage();await login(owner,'owner');
 await owner.goto(`/employees/${employee}?tab=contributions`);
 await owner.getByRole('spinbutton',{name:'SSS',exact:true}).fill('1000.01');await owner.getByRole('spinbutton',{name:'PhilHealth',exact:true}).fill('600');await owner.getByRole('spinbutton',{name:'Pag-IBIG',exact:true}).fill('200');
 await owner.getByRole('button',{name:'Save monthly contributions'}).click();await expect(owner.getByRole('status')).toContainText('saved');
 const sql=e2eSql();try{
 const [term]=await sql`select effective_month::text from employee_contribution_terms where employee_id=${employee}`;
 await owner.goto('/reports/contributions?month='+term.effective_month.slice(0,7));await expect(owner.getByRole('heading',{name:'Employer government contributions',exact:true})).toBeVisible();await expect(owner.getByRole('row',{name:/S001/})).toContainText('₱1,000.01');
 const response=await owner.request.get('/reports/contributions/export?month='+term.effective_month.slice(0,7));expect(response.status()).toBe(200);expect(await response.text()).toContain('1000.01');
 await owner.setViewportSize({width:390,height:844});expect(await owner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await owner.screenshot({path:'test-results/contributions-report-mobile.png'});
 const [staff]=await sql`select id,tabs from users where email='staff@motonorte.test'`;
 await sql`update users set tabs=array['dashboard'] where id=${staff.id}`;
 const staffPage=await (await browser.newContext()).newPage();await login(staffPage,'staff');await staffPage.goto('/reports/contributions');await expect(staffPage).toHaveURL(/\/$/);expect((await staffPage.request.get('/reports/contributions/export?month=2026-11')).status()).toBe(403);
 await sql`update users set tabs=${staff.tabs} where id=${staff.id}`;
 const hash=await hashPassword(process.env.DEV_STAFF_PASSWORD!);
 await sql`insert into users(email,full_name,password_hash,role,access_kind,employee_id,tabs) values('crew-contributions@motonorte.test','Ana sample crew',${hash},'staff','crew',${employee},array['mypay','profile','payslips'])`;
 const crew=await (await browser.newContext()).newPage();await crew.goto('/login');await crew.getByLabel('Email').fill('crew-contributions@motonorte.test');await crew.getByLabel('Password').fill(process.env.DEV_STAFF_PASSWORD!);await crew.getByRole('button',{name:'Sign in'}).click();await expect(crew).toHaveURL(/\/my-pay$/);
 await crew.goto('/reports/contributions');await expect(crew).toHaveURL(/\/my-pay$/);expect((await crew.request.get('/reports/contributions/export?month=2026-11')).status()).toBe(403);
 }finally{await sql.end();await owner.context().close();}
});
test('approved weekly employer values reach crew monthly preview, frozen PDF and report without changing net',async({browser})=>{
 const sql=e2eSql();const owner=await (await browser.newContext()).newPage();let runId:string|undefined;
 try{
 await sql`insert into attendance(employee_id,date,status) select e.id,d::date,case when extract(dow from d)=0 then 'R' else 'F' end::day_status_t from employees e cross join generate_series('2026-11-02'::date,'2026-11-08'::date,'1 day'::interval)d`;
 await login(owner,'owner');await owner.goto('/week/2026-11-02');await owner.getByRole('button',{name:'Generate payroll draft'}).click();await expect(owner).toHaveURL(/\/payroll\/[0-9a-f-]+$/);
 runId=owner.url().split('/').at(-1)!;
 await owner.getByRole('button',{name:'Submit for approval',exact:true}).click();await owner.getByRole('dialog').getByRole('button',{name:'Submit',exact:true}).click();await expect(owner.getByRole('dialog')).not.toBeVisible();
 await owner.getByRole('button',{name:'Approve & lock',exact:true}).click();await owner.getByRole('dialog').getByRole('button',{name:'Approve & lock',exact:true}).click();await expect(owner.getByRole('dialog')).not.toBeVisible();await expect(owner.getByRole('button',{name:'Reopen week'})).toBeVisible();
 const [line]=await sql`select net from payroll_lines where run_id=${runId} and employee_id=${employee}`;expect(line.net).toBe('330000');
 const crew=await (await browser.newContext()).newPage();await crew.goto('/login');await crew.getByLabel('Email').fill('crew-contributions@motonorte.test');await crew.getByLabel('Password').fill(process.env.DEV_STAFF_PASSWORD!);await crew.getByRole('button',{name:'Sign in'}).click();await expect(crew).toHaveURL(/\/my-pay$/);
 await crew.locator('details').first().locator('summary').click();await expect(crew.getByRole('heading',{name:'Employer government contributions'})).toBeVisible();await expect(crew.locator('details').first()).toContainText('₱200.00');await expect(crew.locator('details').first()).toContainText('₱3,300.00');
 await crew.setViewportSize({width:390,height:844});expect(await crew.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await crew.screenshot({path:'test-results/contributions-my-pay-mobile.png',fullPage:true});await crew.setViewportSize({width:1440,height:900});
 await crew.goto('/my-payslips');await crew.getByLabel('From payday').fill('2026-11-01');await crew.getByLabel('To payday').fill('2026-11-30');await expect(crew.getByRole('region',{name:'Selected range totals'})).toContainText('₱200.00');await expect(crew.getByRole('region',{name:'Selected range totals'})).toContainText('Partial month');
 await crew.getByRole('button',{name:'Request admin approval'}).click();await expect(crew.getByRole('status').last()).toContainText('Request sent.');
 await owner.goto('/requests');await owner.getByRole('button',{name:'Approve one download'}).click();await expect(owner.locator('article').filter({hasText:'S001'})).toContainText('APPROVED');
 const [request]=await sql`select id,snapshot from payslip_requests where employee_id=${employee} and status='approved' order by requested_at desc limit 1`;
 expect(request.snapshot.weeks[0].contributions[0].amounts.sss).toBe(20000);expect(request.snapshot.weeks[0].net).toBe(330000);
 const pdf=await crew.request.post(`/my-payslips/${request.id}/download`,{headers:{Origin:'http://localhost:3100'}});expect(pdf.status()).toBe(200);expect((await pdf.body()).subarray(0,8).toString()).toBe('%PDF-1.4');
 writeFileSync('test-results/contributions-monthly.pdf',await pdf.body());
 expect((await crew.request.post(`/my-payslips/${request.id}/download`,{headers:{Origin:'http://localhost:3100'}})).status()).toBe(409);
 await owner.goto('/reports/contributions?month=2026-11');await expect(owner.getByRole('row',{name:/S001/})).toContainText('₱200.00');
 await owner.goto(`/payroll/${runId}/payslips`);await owner.emulateMedia({media:'print'});const slip=owner.locator('.print-slip').filter({hasText:'S001'});await slip.screenshot({path:'test-results/contributions-payslip-desktop.png'});
 expect(await slip.evaluate(el=>el.scrollHeight<=el.clientHeight+2)).toBe(true);
 }finally{
 const cleanupRunId=runId; if(cleanupRunId)await sql.begin(async tx=>{await tx`set local session_replication_role=replica`;await tx`delete from payslip_requests where employee_id=${employee} and range_start='2026-11-01'`;for(const table of ['payroll_contributions','payroll_run_versions','payroll_items','payroll_lines','payroll_runs'])await tx.unsafe(`delete from ${table} where ${table==='payroll_runs'?'id':'run_id'}=$1`,[cleanupRunId]);await tx`delete from attendance where date between '2026-11-02' and '2026-11-08'`;});
 await sql.end();await owner.context().close();
 }
});
