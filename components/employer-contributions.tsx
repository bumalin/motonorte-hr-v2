import {BENEFITS,BENEFIT_LABELS,type ContributionAllocation} from '@/lib/contributions/types.ts';
import {summarizeContributions} from '@/lib/contributions/summary.ts';
import {formatMoney} from '@/lib/format.ts';
export function EmployerContributions({allocations}:{allocations:ContributionAllocation[]|null|undefined}){
 const s=summarizeContributions([{contributions:allocations}]);
 return <section className="mt-4 rounded-md border border-border p-3 text-sm"><h3 className="font-semibold">Employer government contributions</h3>
 {allocations==null?<p className="text-text-muted">Not recorded for this payroll.</p>:<><dl className="grid grid-cols-2 gap-2 mt-2">{BENEFITS.map(k=><div key={k}><dt>{BENEFIT_LABELS[k]}</dt><dd className="font-mono">{formatMoney(s[k])}</dd></div>)}<div><dt>Total employer contribution</dt><dd className="font-mono">{formatMoney(s.total)}</dd></div></dl>{allocations.map(c=><p key={c.benefitMonth} className="mt-2 text-text-muted">Benefit month: {c.benefitMonth.slice(0,7)} · {c.classification.replaceAll('_',' ')}</p>)}</>}
 <p className="mt-2 text-xs text-text-muted">Fully employer-funded; excluded from gross and net pay. Allocation does not confirm remittance.</p></section>;
}
