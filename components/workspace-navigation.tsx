"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect,useRef,useState} from "react";
export type NavigationItem={key:string;href:string;match:string;label:string};
const symbol:Record<string,string>={dashboard:"⌂",week:"▦",employees:"♙",payroll:"₱",catalog:"◇",reports:"▤",settings:"⚙",team:"♧",audit:"↺"};
export function WorkspaceTrail(){const p=usePathname();const titles:Record<string,string>={week:"This week",employees:"Employees",payroll:"Payroll",catalog:"Incentive jobs",reports:"Reports",settings:"Settings",team:"Team members",audit:"Audit log",account:"Your account"};return <div className="workspace-trail"><span>HR &amp; Payroll</span><span aria-hidden="true">/</span><strong>{titles[p.split("/")[1]]||"Dashboard"}</strong></div>}
export function MobileNavigation({nav}:{nav:NavigationItem[]}){
 const p=usePathname(),dialog=useRef<HTMLDialogElement>(null);const [open,setOpen]=useState(false);
 const primary=nav.filter(n=>["dashboard","week","employees","payroll"].includes(n.key));const extra=nav.filter(n=>!["dashboard","week","employees","payroll"].includes(n.key));
 useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close()},[open]);
 useEffect(()=>{dialog.current?.close()},[p]);
 const active=(n:NavigationItem)=>n.match==="/"?p==="/":p.startsWith(n.match);
 return <><nav className="mobile-bottom-nav no-print" aria-label="Mobile navigation">{primary.map(n=><Link key={n.key} href={n.href} aria-current={active(n)?"page":undefined}><span className="nav-symbol" aria-hidden="true">{symbol[n.key]}</span><span>{n.key==="dashboard"?"Home":n.key==="employees"?"Crew":n.label}</span></Link>)}<button aria-label="More pages" aria-expanded={open} onClick={()=>setOpen(true)}><span className="nav-symbol" aria-hidden="true">•••</span><span>More</span></button></nav><dialog ref={dialog} className="more-sheet" onCancel={()=>setOpen(false)} onClose={()=>setOpen(false)} onClick={e=>{if(e.target===e.currentTarget)setOpen(false)}} aria-labelledby="more-title"><div className="more-sheet-header"><h2 id="more-title">More</h2><button onClick={()=>setOpen(false)} aria-label="Close menu">×</button></div><nav aria-label="More pages">{extra.map(n=><Link key={n.key} href={n.href} aria-current={active(n)?"page":undefined} onClick={()=>setOpen(false)}><span aria-hidden="true">{symbol[n.key]}</span>{n.label}<span className="ml-auto" aria-hidden="true">→</span></Link>)}<Link href="/account" onClick={()=>setOpen(false)}>Your account<span className="ml-auto" aria-hidden="true">→</span></Link></nav></dialog></>
}
// Present existing table data as labelled cards on small screens; calculations remain server-side.
export function ResponsiveTables(){const p=usePathname();useEffect(()=>{
 const improve=()=>document.querySelectorAll<HTMLTableElement>(".workspace-content table:not([data-attendance])").forEach(table=>{
  const labels=Array.from(table.tHead?.rows[0]?.cells||[]).map(c=>c.textContent?.trim()||"");if(!labels.length)return;
  if(Array.from(table.tBodies).some(b=>Array.from(b.rows).some(r=>Array.from(r.cells).some(c=>c.colSpan>1))))return;
  table.classList.add("responsive-table");Array.from(table.tBodies).forEach(b=>Array.from(b.rows).forEach(r=>Array.from(r.cells).forEach((c,i)=>{if(labels[i])c.dataset.label=labels[i]})));
 });improve();const observer=new MutationObserver(improve);const main=document.querySelector(".workspace-content");if(main)observer.observe(main,{childList:true,subtree:true});return()=>observer.disconnect();
 },[p]);return null}
