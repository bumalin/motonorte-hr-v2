"use client";
import {useActionState} from 'react';import {BENEFITS,BENEFIT_LABELS} from '@/lib/contributions/types.ts';import {saveContributions} from '../contribution-actions.ts';
export function ContributionForm({employeeId,amounts}:{employeeId:string;amounts?:{sss:number;philhealth:number;pagibig:number}}){
 const [state,action,pending]=useActionState(saveContributions,undefined);
 return <form action={action} className="space-y-4 max-w-xl"><input type="hidden" name="employee_id" value={employeeId}/><p className="text-sm text-text-muted">Enter monthly totals funded entirely by the employer. Changes start next month. Recording begins November 2026. These amounts do not change earnings or take-home pay.</p>
 <div className="grid gap-3 sm:grid-cols-3">{BENEFITS.map(k=><label key={k}>{BENEFIT_LABELS[k]}<input type="number" min="0" max="1000000" step="0.01" name={k} required defaultValue={amounts?(amounts[k]/100).toFixed(2):''} className="mt-1 block w-full rounded-md border border-border p-2"/></label>)}</div>
 <button disabled={pending} className="rounded-md bg-brand-600 px-4 py-2 text-white">{pending?'Saving…':'Save monthly contributions'}</button><p role="alert">{state?.error}</p><p role="status">{state?.ok}</p></form>;
}
