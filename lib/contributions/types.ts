export type BenefitAmounts={sss:number;philhealth:number;pagibig:number};
export type ContributionTerm={id:string;effectiveMonth:string;amounts:BenefitAmounts};
export type ContributionAllocation={employeeId:string;benefitMonth:string;amounts:BenefitAmounts;monthly:BenefitAmounts;classification:'ordinary'|'joining_catchup'|'final_settlement';provenance:Record<string,unknown>};
export type ApprovedAllocation={runId?:string;payday:string;benefitMonth:string;amounts:BenefitAmounts};
export type ContributionInput={employeeId:string;hireDate:string;endDate:string|null;periodStart:string;payday:string;rolloutMonth:string;terms:ContributionTerm[];approved:ApprovedAllocation[]};
export const BENEFITS=['sss','philhealth','pagibig'] as const;
export const BENEFIT_LABELS={sss:'SSS',philhealth:'PhilHealth',pagibig:'Pag-IBIG'} as const;
/** A payroll line whose employer contributions were not recorded (pre-rollout run or no configured amounts). */
export const contributionsUnrecorded=(coverage:string|undefined)=>coverage==='legacy'||coverage==='unconfigured';
export const ROLLOUT_MONTH='2026-11-01';
