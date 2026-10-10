"use client";
import {useActionState,useEffect,useState} from "react";
import {requestPayslip} from "./actions.ts";
import {RangeTotals} from "@/components/range-totals.tsx";
import type {RangeSummary} from "@/lib/portal/summary.ts";
import {validRange} from "@/lib/portal/range.ts";
export function RequestForm({from,to}:{from:string;to:string}){
 const [start,setStart]=useState(from),[end,setEnd]=useState(to),[month,setMonth]=useState("");
 const [state,action,pending]=useActionState(requestPayslip,undefined);
 const [preview,setPreview]=useState<{key:string;summary?:RangeSummary;error?:string}|null>(null);
 const key=start+"/"+end,valid=validRange(start,end),current=preview?.key===key?preview:null;
 useEffect(()=>{
  if(!valid)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>{fetch("/my-payslips/preview?"+new URLSearchParams({from:start,to:end}),{signal:controller.signal,cache:"no-store"})
   .then(async response=>{if(!response.ok)throw new Error("Unable to load totals. Refresh or sign in again.");return response.json() as Promise<RangeSummary>;})
   .then(summary=>{if(!controller.signal.aborted)setPreview({key,summary});})
   .catch(error=>{if(!controller.signal.aborted)setPreview({key,error:error instanceof Error?error.message:"Unable to load totals."});});
  },200);
  return ()=>{clearTimeout(timer);controller.abort();};
 },[start,end,key,valid]);
 return <form action={action} className="portal-card space-y-4"><h2>Request a printable PDF</h2>
 <label className="block">Choose a whole month<select name="month" value={month} className="portal-input" onChange={e=>{setMonth(e.target.value);if(!e.target.value)return;const [y,m]=e.target.value.split("-").map(Number);setStart(e.target.value+"-01");setEnd(e.target.value+"-"+new Date(Date.UTC(y,m,0)).getUTCDate());}}><option value="">Custom date range</option>{Array.from({length:36},(_,i)=>{const d=new Date(from.slice(0,7)+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()-i);const value=d.toISOString().slice(0,7);return <option value={value} key={value}>{d.toLocaleDateString("en-PH",{month:"long",year:"numeric",timeZone:"UTC"})}</option>;})}</select></label>
 <div className="grid sm:grid-cols-2 gap-4"><label>From payday<input type="date" required name="from" className="portal-input" value={start} onChange={e=>{setMonth("");setStart(e.target.value);}}/></label><label>To payday<input type="date" required name="to" className="portal-input" value={end} onChange={e=>{setMonth("");setEnd(e.target.value);}}/></label></div>
 <p className="text-sm text-text-muted">Includes complete approved weekly payroll with a scheduled payday in this range. Admin reviews the exact weeks and combined totals before approving. Draft weeks are excluded.</p>
 {valid&&!current&&<p role="status">Loading selected range totals…</p>}
 {current?.summary&&<RangeTotals summary={current.summary}/>}
 {current?.error&&<p role="alert">{current.error}</p>}
 <button className="portal-button" disabled={pending||!valid||!current?.summary?.approvedWeeks}>Request admin approval</button><p role="alert">{state?.error}</p><p role="status">{state?.ok}</p></form>;
}

export function DownloadButton({id}:{id:string}){const [pending,setPending]=useState(false),[error,setError]=useState("");async function download(){setPending(true);setError("");try{const res=await fetch(`/my-payslips/${id}/download`,{method:"POST",headers:{"Content-Type":"application/json"}});if(!res.ok)throw new Error(await res.text());const blob=await res.blob();const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="MotoNorte-Payslips-"+id+".pdf";a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);location.reload();}catch(e){setError(e instanceof Error?e.message:"Download failed");setPending(false);}}return <><button className="portal-button" disabled={pending} onClick={download}>Use approval · download PDF once</button><p role="alert">{error}</p><p className="text-xs text-text-muted mt-2">This consumes the approval. Save the downloaded file; it can then be printed. If delivery fails, ask your admin to approve a new request.</p></>;}
