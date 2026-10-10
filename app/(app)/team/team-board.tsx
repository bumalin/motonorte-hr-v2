"use client";
// Team members list + drawer (design: Team Members.html). All writes go through the existing owner-only server actions.
import {useActionState,useEffect,useRef,useState} from "react";
import {TABS} from "@/lib/auth/tabs.ts";
import {addUser,setUserActive,updateUser,type SettingsState} from "../settings/actions.ts";
import {createCrew,updateCrew,type CrewState} from "./crew-actions.ts";

export type Member={access_kind:string;id:string;email:string;full_name:string;role:string;tabs:string[];active:boolean;last:string;pending:boolean;phone:string|null;address:string|null;emergency_contact:string|null;emergency_contact_phone:string|null};
type Employee={id:string;code:string;full_name:string};

const PERSONAL=["profile","mypay","payslips"];
// "requests" is owner-only in hasTab(), so it is never offered to staff.
const OFFICE=TABS.filter(t=>!PERSONAL.includes(t.key)&&t.key!=="requests");
const CREW=TABS.filter(t=>PERSONAL.includes(t.key));
const HINTS:Record<string,string>={team:"Staff see own account only",payroll:"Final approval stays admin",week:"Attendance edits stay admin",mypay:"Own pay history",profile:"Own details",payslips:"Request PDF copies"};
const isCrew=(m:Member)=>m.access_kind==="crew";
const initials=(n:string)=>n.split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase();
const roleLabel=(m:Member)=>m.role==="owner"?"ADMINISTRATOR":isCrew(m)?"EMPLOYEE":"STAFF";
const status=(m:Member)=>m.active?"Active":m.pending?"Pending activation":"Inactive";

export function TeamBoard({members,employees,admin,selfId}:{members:Member[];employees:Employee[];admin:boolean;selfId:string}){
 const [filter,setFilter]=useState("all");const [query,setQuery]=useState("");const [open,setOpen]=useState<string|null>(null);
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const d=dialog.current;if(!d)return;if(open&&!d.open)d.showModal();if(!open&&d.open)d.close();},[open]);
 const counts={all:members.length,staff:members.filter(m=>!isCrew(m)).length,crew:members.filter(isCrew).length,inactive:members.filter(m=>!m.active).length};
 const q=query.trim().toLowerCase();
 const shown=members.filter(m=>(filter==="all"||(filter==="staff"&&!isCrew(m))||(filter==="crew"&&isCrew(m))||(filter==="inactive"&&!m.active))&&(!q||m.full_name.toLowerCase().includes(q)||m.email.toLowerCase().includes(q)));
 const cur=members.find(m=>m.id===open);
 return <section className="team-board">
  <div className="team-toolbar">
   <div className="team-filters" role="tablist" aria-label="Filter members">{([["all","All"],["staff","Staff"],["crew","Employees"],["inactive","Inactive"]] as const).map(([k,label])=><button key={k} role="tab" aria-selected={filter===k} onClick={()=>setFilter(k)}>{label}<span>{counts[k]}</span></button>)}</div>
   <div className="team-toolbar-end"><input type="search" placeholder="Search name or email" aria-label="Search name or email" value={query} onChange={e=>setQuery(e.target.value)}/>{admin&&<button className="team-primary" onClick={()=>setOpen("new")}>Add member</button>}</div>
  </div>
  <div className="team-cols" aria-hidden="true"><span>MEMBER</span><span>ROLE</span><span>ACCESS</span><span>LAST SEEN</span><span>STATUS</span><span/></div>
  <ul className="team-rows">{shown.map(m=>{const pool=isCrew(m)?CREW:OFFICE;const on=(k:string)=>m.role==="owner"||m.tabs.includes(k);const n=pool.filter(t=>on(t.key)).length;
   const body=<><span className="team-member"><span className="team-avatar">{initials(m.full_name)}</span><span className="min-w-0"><strong>{m.full_name}</strong><small>{m.email}</small></span></span>
    <span className="team-role">{roleLabel(m)}</span>
    <span className="team-access"><span className="team-segs">{pool.map(t=><i key={t.key} data-on={on(t.key)||undefined}/>)}</span><small>{isCrew(m)?`${n} / ${pool.length} personal`:n===pool.length?"All tabs":`${n} / ${pool.length} tabs`}</small></span>
    <span className="team-last">{m.last}</span>
    <span className="team-status"><i data-state={m.active?"on":m.pending?"pending":"off"}/>{status(m)}</span>
    <span className="team-arrow" aria-hidden="true">{admin?"→":""}</span></>;
   return <li key={m.id} data-inactive={!m.active||undefined} data-selected={open===m.id||undefined}>{admin?<button className="team-row" onClick={()=>setOpen(m.id)} aria-label={`Edit ${m.full_name}`}>{body}</button>:<div className="team-row">{body}</div>}</li>;})}
   {!shown.length&&<li className="team-empty">No members match this view.</li>}
  </ul>
  {admin&&<dialog ref={dialog} className="team-drawer" onClose={()=>setOpen(null)} aria-label={cur?`Edit ${cur.full_name}`:"Add member"}>
   {open&&<div className="team-drawer-inner">
    {cur?(isCrew(cur)?<EditCrew key={cur.id} m={cur} self={cur.id===selfId} close={()=>setOpen(null)}/>:<EditStaff key={cur.id} m={cur} self={cur.id===selfId} close={()=>setOpen(null)}/>)
     :open==="new"&&<NewMember employees={employees} close={()=>setOpen(null)}/>}
   </div>}
  </dialog>}
 </section>;
}

function DrawerHead({eyebrow,title,sub,avatar,close}:{eyebrow:string;title:string;sub?:string;avatar?:string;close:()=>void}){
 return <div className="team-drawer-head">{avatar&&<span className="team-avatar team-avatar-lg">{avatar}</span>}<div className="min-w-0 flex-1"><p className="team-eyebrow-red">{eyebrow}</p><h2>{title}</h2>{sub&&<p className="team-sub">{sub}</p>}</div><button type="button" className="team-x" onClick={close} aria-label="Close">×</button></div>;
}

function Tiles({pool,selected,onChange}:{pool:readonly {key:string;label:string}[];selected:string[];onChange:(t:string[])=>void}){
 return <fieldset className="team-tiles-wrap"><div className="team-label-row"><legend className="team-label">TAB ACCESS · {selected.length} OF {pool.length}</legend><span><button type="button" onClick={()=>onChange(pool.map(t=>t.key))}>Select all</button><button type="button" onClick={()=>onChange([])}>Clear</button></span></div>
  <div className="team-tiles">{pool.map(t=>{const on=selected.includes(t.key);return <label key={t.key} className="team-tile" data-on={on||undefined}>
   <input type="checkbox" name="tabs" value={t.key} checked={on} onChange={()=>onChange(on?selected.filter(k=>k!==t.key):pool.map(p=>p.key).filter(k=>k===t.key||selected.includes(k)))} className="sr-only"/>
   <span className="team-box" aria-hidden="true">{on?"✓":""}</span><span><span className="block">{t.label}</span><small>{HINTS[t.key]??""}</small></span></label>;})}</div></fieldset>;
}

function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="team-field"><span className="team-label">{label}</span>{children}</label>;}

function Contact({m}:{m?:Partial<Member>}){
 return <details className="team-more"><summary>Contact &amp; emergency details (optional)</summary><div className="team-grid2">
  <Field label="PHONE"><input name="phone" type="tel" defaultValue={m?.phone??""}/></Field>
  <Field label="ADDRESS"><input name="address" defaultValue={m?.address??""}/></Field>
  <Field label="EMERGENCY CONTACT"><input name="emergency_contact" defaultValue={m?.emergency_contact??""}/></Field>
  <Field label="CONTACT NUMBER"><input name="emergency_contact_phone" type="tel" defaultValue={m?.emergency_contact_phone??""}/></Field>
 </div></details>;
}

function Footer({note,error,pending,label,close}:{note?:string;error?:string;pending:boolean;label:string;close:()=>void}){
 return <div className="team-drawer-foot"><span role={error?"alert":"status"} data-error={!!error||undefined}>{error??note}</span><span className="flex gap-2"><button type="button" className="team-ghost" onClick={close}>Close</button><button className="team-primary" disabled={pending}>{label}</button></span></div>;
}

function Code({code}:{code?:string}){
 if(!code)return null;
 return <div className="team-code"><p className="team-label">ONE-TIME ACTIVATION CODE</p><code>{code}</code><p>Copy it now and share privately. They open /activate with their email. Valid for 7 days.</p></div>;
}

function Deactivate({m}:{m:Member}){
 const [ask,setAsk]=useState(false);
 const [err,act,pending]=useActionState(async(_:string|void,f:FormData)=>{const e=await setUserActive(f);if(!e)setAsk(false);return e;},undefined);
 if(isCrew(m)&&!m.active)return null; // crew are reactivated by issuing a new activation code
 return <form action={act} className="team-card"><input type="hidden" name="id" value={m.id}/><input type="hidden" name="active" value={String(!m.active)}/>
  <div className="team-card-row"><div><strong>{m.active?"Deactivate account":"Reactivate account"}</strong><p>{m.active?"Signs them out and blocks sign-in. History is kept.":"Restores sign-in with their current tabs."}</p></div>
   {!ask&&(m.active?<button type="button" className="team-danger" onClick={()=>setAsk(true)}>Deactivate</button>:<button className="team-ghost" disabled={pending}>Reactivate</button>)}</div>
  {ask&&<div className="team-confirm"><span>Sign {m.full_name.split(" ")[0]} out now?</span><span className="flex gap-2"><button type="button" className="team-ghost" onClick={()=>setAsk(false)}>Keep active</button><button className="team-danger-solid" disabled={pending}>Deactivate</button></span></div>}
  {err?<p role="alert" className="text-sm text-danger">{err}</p>:null}
 </form>;
}

function EditStaff({m,self,close}:{m:Member;self:boolean;close:()=>void}){
 const [s,act,pending]=useActionState<SettingsState,FormData>(updateUser,undefined);
 const [role,setRole]=useState(m.role);const [tabs,setTabs]=useState(m.tabs.filter(t=>OFFICE.some(o=>o.key===t)));
 return <><DrawerHead eyebrow={`${roleLabel(m)} · ${m.email}`} title={m.full_name} sub={`Last sign-in ${m.last}`} avatar={initials(m.full_name)} close={close}/>
  <form action={act} className="team-drawer-form"><input type="hidden" name="id" value={m.id}/>
   <div className="team-drawer-body">
    <div className="team-grid2"><Field label="NAME"><input name="full_name" required defaultValue={m.full_name}/></Field>
     <Field label="ROLE"><select name="role" value={role} onChange={e=>setRole(e.target.value)} disabled={self}><option value="staff">Staff</option><option value="owner">Administrator</option></select></Field></div>
    {self&&<input type="hidden" name="role" value={role}/>}
    <Field label="LOGIN EMAIL"><input name="email" type="email" required defaultValue={m.email}/></Field>
    {role==="owner"?<p className="team-sub">Administrators open every tab.</p>:<Tiles pool={OFFICE} selected={tabs} onChange={setTabs}/>}
    {!self&&<Field label="RESET PASSWORD (OPTIONAL)"><PasswordInput required={false}/><small className="team-sub">A new password signs them out.</small></Field>}
    <Contact m={m}/>
   </div>
   <Footer note="Changes apply on their next request." error={s?.error} pending={pending} label="Save" close={close}/>
   {s?.ok&&<p role="status" className="team-ok">{s.ok}</p>}
  </form>
  {!self&&<div className="team-drawer-body pt-0"><p className="team-label">SECURITY</p><Deactivate m={m}/></div>}</>;
}

function EditCrew({m,self,close}:{m:Member;self:boolean;close:()=>void}){
 const [s,act,pending]=useActionState<CrewState,FormData>(updateCrew,undefined);
 const [tabs,setTabs]=useState(m.tabs);
 return <><DrawerHead eyebrow={`EMPLOYEE · ${m.email}`} title={m.full_name} sub={m.pending?"Activation pending":`Last sign-in ${m.last}`} avatar={initials(m.full_name)} close={close}/>
  <form action={act} className="team-drawer-form"><input type="hidden" name="id" value={m.id}/>
   <div className="team-drawer-body">
    <Field label="LOGIN EMAIL"><input name="email" type="email" required defaultValue={m.email}/></Field>
    <Tiles pool={CREW} selected={tabs} onChange={setTabs}/>
    <p className="team-label">SECURITY</p>
    <div className="team-card team-card-row"><div><strong>Replacement activation code</strong><p>Saves the changes above, issues a new code and signs them out.</p></div><button name="reset" value="yes" className="team-ghost" disabled={pending}>Generate</button></div>
    <Code code={s?.code}/>
   </div>
   <Footer note="Changes apply on their next request." error={s?.error} pending={pending} label="Save" close={close}/>
   {s?.ok&&<p role="status" className="team-ok">{s.ok}</p>}
  </form>
  {!self&&<div className="team-drawer-body pt-0"><Deactivate m={m}/></div>}</>;
}

/** Temporary password field with a generator (crypto-random, 16 chars; server enforces the minimum). */
function PasswordInput({required}:{required:boolean}){
 const [v,setV]=useState("");
 const gen=()=>{const abc="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";setV(Array.from(crypto.getRandomValues(new Uint32Array(16)),n=>abc[n%abc.length]).join(""));};
 return <span className="team-pass"><input name="password" value={v} onChange={e=>setV(e.target.value)} required={required} minLength={12} autoComplete="new-password" spellCheck={false}/><button type="button" onClick={gen}>Generate</button></span>;
}

function NewMember({employees,close}:{employees:Employee[];close:()=>void}){
 const [kind,setKind]=useState<"staff"|"crew">("staff");
 return <><DrawerHead eyebrow="NEW ACCOUNT" title="Add member" close={close}/>
  <div className="team-drawer-body pb-0"><div className="team-kinds" role="radiogroup" aria-label="Account type">{([["staff","Staff login","Shop staff or admins. Pick any workspace tabs."],["crew","Employee login","Link an existing employee to their own pay and profile."]] as const).map(([k,l,d])=><button key={k} type="button" role="radio" aria-checked={kind===k} onClick={()=>setKind(k)}><strong>{l}</strong><span>{d}</span></button>)}</div></div>
  {kind==="staff"?<NewStaff close={close}/>:<NewCrew employees={employees} close={close}/>}</>;
}

function NewStaff({close}:{close:()=>void}){
 const [s,act,pending]=useActionState<SettingsState,FormData>(addUser,undefined);
 const [role,setRole]=useState("staff");const [tabs,setTabs]=useState<string[]>([]);
 return <form action={act} className="team-drawer-form"><div className="team-drawer-body">
  <div className="team-grid2"><Field label="NAME"><input name="full_name" required/></Field><Field label="ROLE"><select name="role" value={role} onChange={e=>setRole(e.target.value)}><option value="staff">Staff</option><option value="owner">Administrator</option></select></Field></div>
  <Field label="LOGIN EMAIL"><input name="email" type="email" required placeholder="name@email.com"/></Field>
  <Field label="TEMPORARY PASSWORD"><PasswordInput required/><small className="team-sub">Share it privately. They can change it under Your account.</small></Field>
  <Contact/>
  {role==="owner"?<p className="team-sub">Administrators open every tab.</p>:<Tiles pool={OFFICE} selected={tabs} onChange={setTabs}/>}
 </div><Footer error={s?.error} note={s?.ok} pending={pending} label="Create account" close={close}/></form>;
}

function NewCrew({employees,close}:{employees:Employee[];close:()=>void}){
 const [s,act,pending]=useActionState<CrewState,FormData>(createCrew,undefined);
 const [tabs,setTabs]=useState<string[]>(CREW.map(t=>t.key));
 return <form action={act} className="team-drawer-form"><div className="team-drawer-body">
  <Field label="EMPLOYEE RECORD"><select name="employee_id" required defaultValue=""><option value="" disabled>Choose employee</option>{employees.map(e=><option key={e.id} value={e.id}>{e.code} · {e.full_name}</option>)}</select><small className="team-sub">No invitation email — they sign in with the activation code you give them.</small></Field>
  <Field label="LOGIN EMAIL"><input name="email" type="email" required placeholder="name@email.com"/></Field>
  <Tiles pool={CREW} selected={tabs} onChange={setTabs}/>
  <Code code={s?.code}/>
 </div><Footer error={s?.error} note={s?.code?undefined:s?.ok} pending={pending} label="Create account" close={close}/></form>;
}
