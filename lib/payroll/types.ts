// Pay engine types. All money is integer centavos (PR-001); multipliers are integer hundredths (ADR-003).
// Dates are ISO "YYYY-MM-DD" calendar dates in Asia/Manila (PR-003).

export type Centavos = number;
export type IsoDate = string;
export type DayStatus = "F" | "H" | "A" | "R";
export type Position = "staff" | "mechanic" | "technician";
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface PayTerm {
  from: IsoDate;
  position: Position;
  dailyRate: Centavos;
  dailyAllowance?: Centavos; // PR-062; missing = 0
}

export interface EmployeeInput {
  id: string;
  code: string;
  restDay: Weekday;
  hireDate: IsoDate;
  endDate?: IsoDate | null;
  terms: PayTerm[]; // approved terms only
}

export interface Settings {
  from: IsoDate;
  restDayWorked: number; // hundredths, e.g. 100 = 1.00×
  holidayWorked: number;
  holidayUnworked: number;
  ot: number; // 125 = 1.25×
}

export interface CatalogJob {
  id: string;
  code: string;
  name: string;
  amounts: { from: IsoDate; amount: Centavos }[];
}

export interface AttendanceEntry {
  employeeId: string;
  date: IsoDate;
  status: DayStatus;
  otMinutes: number;
}

export interface JobEntry {
  date: IsoDate;
  jobId: string;
  qty: number;
  employeeId?: string | null; // job for a specific mechanic (PR-055); missing/null = daily pool
}

export interface Adjustment {
  employeeId: string;
  kind: "allowance" | "deduction";
  type: string;
  amount: Centavos;
  reason: string;
}

export interface PeriodInput {
  periodStart: IsoDate; // a Monday
  settings: Settings[]; // effective-dated
  holidays: IsoDate[];
  employees: EmployeeInput[]; // everyone employed on at least one day of the period
  catalog: CatalogJob[];
  attendance: AttendanceEntry[];
  jobs: JobEntry[];
  adjustments: Adjustment[];
  carriedIn: Record<string, Centavos>; // by employee id
}

export interface PayLine {
  employeeId: string;
  code: string;
  basic: Centavos;
  base: Centavos;
  ot: Centavos;
  incentive: Centavos;
  allowances: Centavos;
  deductions: Centavos;
  carriedIn: Centavos;
  gross: Centavos;
  net: Centavos;
  carryOut: Centavos;
}

export type ItemKind = "base" | "ot" | "incentive" | "allowance" | "deduction" | "carried_in";

export interface PayItem {
  employeeId: string;
  date: IsoDate | null;
  kind: ItemKind;
  amount: Centavos;
  ruleId: string;
  source: Record<string, unknown>;
}

export type PayrollErrorCode =
  | "MISSING_ATTENDANCE"
  | "INVALID_OT"
  | "NO_ELIGIBLE_MECHANIC"
  | "NOT_EMPLOYED"
  | "NO_PAY_TERMS"
  | "UNKNOWN_JOB"
  | "NO_SETTINGS"
  | "INVALID_SPECIALIST";

export interface PayrollError {
  code: PayrollErrorCode;
  date: IsoDate;
  employeeId?: string;
  employeeCode?: string;
  jobId?: string;
}

export type PeriodResult =
  | { ok: true; lines: PayLine[]; items: PayItem[] }
  | { ok: false; errors: PayrollError[] };
