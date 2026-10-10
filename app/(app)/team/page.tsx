import {requireTab} from "@/lib/auth/session.ts";
import {withUser} from "@/lib/db/client.ts";
import {TeamBoard,type Member} from "./team-board.tsx";
type Row={access_kind:string;activation_expires_at:Date|null;id:string;email:string;full_name:string;role:string;tabs:string[];active:boolean;last_login_at:Date|null;phone:string|null;address:string|null;emergency_contact:string|null;emergency_contact_phone:string|null};
const when=(d:Date)=>d.toLocaleString("en-PH",{timeZone:"Asia/Manila",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
const POINTS=[["No presets","Every account gets its own tab selection."],["Admin-only actions","Attendance edits, final payroll approval and team management."],["Applies right away","Tab changes apply on their next request. Resets sign them out."]];
export default async function TeamPage(){
 const actor=await requireTab("team");const admin=actor.role==="owner";
 const rows=await withUser(actor.id,tx=>tx<Row[]>`select access_kind,activation_expires_at,id,email,full_name,role,tabs,active,last_login_at,phone,address,emergency_contact,emergency_contact_phone from users order by role desc,full_name`);
 const employees=admin?await withUser(actor.id,tx=>tx<{id:string;code:string;full_name:string}[]>`select e.id,e.code,e.full_name from employees e where not exists(select 1 from users u where u.employee_id=e.id) order by e.code`):[];
 const members:Member[]=rows.map(({last_login_at,activation_expires_at,...m})=>({...m,last:last_login_at?when(last_login_at):"Never",pending:!m.active&&!!activation_expires_at}));
 return <div className="team-page"><div className="team-head"><div><p className="eyebrow">— PEOPLE &amp; ACCESS</p><h1>Team <span>members</span></h1><p className="page-description">One login per person. You choose exactly which tabs they open.</p></div></div>
  <div className="team-points">{POINTS.map(([t,d],i)=><div key={t}><span>{String(i+1).padStart(2,"0")}</span><div><strong>{t}</strong><p>{d}</p></div></div>)}</div>
  <TeamBoard members={members} employees={employees} admin={admin} selfId={actor.id}/></div>;
}
