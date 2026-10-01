# PRD — Motonorte HR & Payroll (MVP)

Status: **v2 — APPROVED by Owner 2026-09-26**
Owner agent: product-manager · Updated: 2026-09-26

## 1. Problem

Motonorte (~20 employees: staff, mechanics, technicians) pays everyone weekly by bank transfer. Mechanics also earn incentives from defined jobs (e.g. Throttle Body Cleaning = ₱150), pooled daily and split among mechanics present. Today this is tallied by hand — slow, error-prone, hard for mechanics to verify, and gives the Owner no clear view of labor cost vs. jobs done.

## 2. Success metrics

| Metric | Target |
|---|---|
| Time to prepare weekly payroll | < 30 min from week close to Owner approval |
| Calculation errors found after release | 0 per quarter |
| Incentive disputes | ↓ 80% (every peso traceable to a day's jobs and attendance) |
| Owner sees weekly labor cost + incentive total | Same day as approval |

## 3. Personas

| Persona | Goals | Pains today |
|---|---|---|
| **HR / Finance Staff** (2 people) | Keep employees, attendance and job logs accurate; prepare payroll; send bank file | Retyping job sheets, manual pool math, no audit trail |
| **Owner** | Final approval on pay; see labor cost and productivity; set pay rates and incentive amounts | Must trust spreadsheets; no real-time visibility |
| *Employee* (data subject, not a user in MVP) | Get paid correctly; understand payslip | Can't see how incentives were counted |

Positions: **Staff**, **Mechanic**, **Technician**. Only **Mechanics** earn incentives.

## 4. Role / permission matrix

| Capability | HR/Finance Staff | Owner |
|---|---|---|
| Manage employees (create/edit/deactivate) | ✅ | ✅ |
| Set daily rate | propose | ✅ approve |
| View sensitive data (gov't IDs, bank account) | ✅ | ✅ |
| Manage incentive job catalog (job + ₱) | view | ✅ |
| Log attendance and incentive jobs | ✅ | ✅ |
| Add allowances / deductions | ✅ | ✅ |
| Generate payroll draft & submit for approval | ✅ | ✅ |
| **Approve & lock payroll run** | — | ✅ only |
| Generate payslips & bank transfer file (locked runs only) | ✅ | ✅ |
| Reopen a locked run (creates adjustment, never edits) | — | ✅ |
| Dashboards & reports | ✅ | ✅ |
| Audit log | view | view |

## 5. Pay model (summary — exact rules go in `02-payroll-rules.md`)

- **Pay period:** Monday–Sunday. **Payday:** Sunday of the same week. Hours 8:30 AM–5:30 PM.
- **Base pay:** days present × employee's daily rate (set per employee by the Owner). Half day = half the daily rate. HR marks each day full / half / absent / rest day; no automatic lateness deductions (default — confirm **OQ-16**).
- **Rest day:** each employee has 1 designated rest day per week. Work on the rest day is paid at the **regular daily rate** (multiplier stored as a setting, currently 1.00 — see legal note in §10).
- **Overtime:** hours worked after 5:30 PM (beyond 8 hours) = (daily rate ÷ 8) × 1.25 per hour. OT hours are entered by HR per day.
- **Holidays:** no holiday premium. Worked holiday = regular daily rate; unworked holiday = no pay. Stored as editable multipliers (worked 1.00, unworked 0.00).
- **Incentives (Mechanics only):** for each day, sum all logged incentive jobs → divide equally among Mechanics with a **full-day** presence that day. Half-day Mechanics get no share. Staff and Technicians never share.
- **Allowances / deductions:** ad hoc entries with type + reason (cash advance, clawback for a comeback job, etc.). No cap; if deductions exceed the week's gross, net = ₱0 and the balance carries to the next payday.
- **Government contributions and tax:** handled by the accountant / third-party provider, paid fully by the company. Nothing is deducted from weekly pay. Employees are tax-exempt; no withholding tax in the system.
- **13th month:** total basic pay earned in the calendar year ÷ 12. **Incentives excluded.**

## 6. User stories

### Employees
**US-001 (Must)** — As HR/Finance, I want to create an employee (name, position, daily rate, hire date, gov't ID numbers, bank name + account) so that they can be paid.
- Given all required fields, when I save, then the employee appears in the active list and an audit entry is created.
- Given a missing required field, when I save, then I see a field-level error and nothing is saved.

**US-002 (Must)** — As the Owner, I want daily rates to be effective-dated so that a raise applies only from its start date.
- Given a new rate effective Wednesday, when this week's payroll runs, then Mon–Tue use the old rate and Wed–Sun the new rate.

**US-003 (Must)** — As HR/Finance, I want to deactivate (not delete) an employee so that history stays intact.
- Given a deactivated employee, when a new run is generated, then they are excluded; past runs still show them.

### Incentive job catalog
**US-010 (Must)** — As the Owner, I want to maintain the incentive job list (name, ₱ amount, active flag, effective date) so that incentives are consistent.
- Given "Throttle Body Cleaning = ₱150", when a job is logged, then ₱150 enters that day's pool.
- Given I change it to ₱180 effective next Monday, when a job is logged this week, then ₱150 still applies.

### Attendance & job log
**US-020 (Must)** — As HR/Finance, I want to log incentive jobs per day (date, job type, qty, work-order/plate reference) so that the daily pool is computed.
- Given ₱600 of jobs on Tuesday and 3 Mechanics present full-day, when the week is computed, then each earns ₱200.
- Given 3 full-day Mechanics and 1 half-day Mechanic, then the pool is split 3 ways and the half-day Mechanic gets ₱0 incentive.
- Given the pool doesn't divide evenly to the centavo, then the remainder is allocated per the rounding rule so shares sum exactly to the pool.
- Given jobs are logged on a day with no full-day Mechanic present, then the draft is blocked with an error to fix.

**US-021 (Must)** — As HR/Finance, I want to record attendance per employee per day (full day / half day / absent / rest day, OT hours) so that base pay is correct.
- Given 6 full days at ₱X, then base pay = 6 × X.
- Given 2 OT hours at ₱X daily rate, then OT pay = 2 × (X ÷ 8) × 1.25.
- Given work on the employee's rest day, then that day is paid at the regular daily rate.
- Given work on a holiday in the holiday calendar, then that day uses the holiday's multiplier.

**US-022 (Should)** — Import attendance from CSV (biometric export).

**US-023 (Must)** — As the Owner, I want a week's attendance and job log to become read-only once its run is locked.
- Given a locked week, when anyone edits its entries, then the edit is refused and they are prompted to add an adjustment instead.

### Payroll run
**US-030 (Must)** — As HR/Finance, I want to generate the weekly payroll draft so that each employee's pay is computed automatically.
- Each line shows: days worked, base pay, premiums, incentive share (itemized per day), allowances, deductions (with carried-over balance), gross, net.
- Deterministic: generating twice from the same data gives identical results to the centavo.

**US-031 (Must)** — As the Owner, I want to drill into any amount so that I can verify before approving.
- Given any amount, when I open it, then I see the source entries (days, jobs, co-present Mechanics) and the rule ID.

**US-032 (Must)** — As HR/Finance, I want to submit a draft; as the Owner, I want to approve and lock it.
- Given a submitted run, when the Owner approves, then it locks, no line can change, and the audit log records who/when.
- Given a staff user, then the Approve button is not available.

**US-033 (Must)** — As HR/Finance, I want allowances and deductions (cash advances, clawbacks, corrections, retro pay) as separate entries with a reason so that locked runs are never edited.
- Given deductions exceed gross, then net = ₱0 and the remainder carries to the next payday, visible on both payslips.

**US-034 (Must)** — As HR/Finance, I want a PDF payslip per employee from a locked run.
- Shows base, premiums, each day's incentive share with the jobs in that day's pool, allowances, deductions, net.

**US-035 (Must)** — As HR/Finance, I want a bank transfer file from a locked run in **RCBC Corporate** bulk-upload format so that I can upload payouts in one go.
- Exact column layout follows RCBC's payroll/bulk credit template (**OQ-18a**: please share a blank template or sample file from your RCBC Corporate portal).

### Year-end & reporting
**US-040 (Must)** — As HR/Finance, I want a monthly compensation summary export per employee so that the accountant/third party can compute government contributions.

**US-041 (Should)** — As HR/Finance, I want 13th-month pay computed (basic pay ÷ 12, incentives excluded) so that it's ready by Dec 24.

**US-050 (Must)** — As the Owner, I want a dashboard: weekly payroll total, incentive total, top job types, incentives per Mechanic, attendance rate.

### AI (OpenAI)
**US-051 (Should)** — As the Owner, I want an "Explain this payslip" button that describes in plain language how the pay was computed, using only stored line items (AI never calculates).
- Given the AI is unavailable, then the itemized breakdown is shown instead.

**US-052 (Could)** — Ask report questions in plain language ("Which job types earned the most in August?").

**US-053 (Could)** — AI flags unusual weeks (e.g. a day's pool 3× the average) for Owner review.

### Security & audit
**US-060 (Must)** — As the Owner, I want every pay-affecting change recorded (who, what, before/after, when).

**US-061 (Must)** — As a user, I sign in with email + password (app-managed accounts, no public sign-up) and see only what my role allows. Two roles: `staff`, `owner`.

## 7. MVP scope

**Must:** US-001–003, 010, 020, 021, 023, 030–035, 040, 050, 060, 061
**Should:** US-022, 041, 051
**Could:** US-052, 053

## 8. Out of scope (MVP)

- Government contribution (SSS/PhilHealth/Pag-IBIG) computation and withholding tax — handled by accountant / third party
- Employee self-service portal
- Biometric device integration (CSV import is Should)
- Leave balances (SIL) beyond marking attendance
- Direct bank API payouts (file upload only)
- Multi-branch
- Work-order / POS integration

## 9. Decisions log

| ID | Decision |
|---|---|
| OQ-1 | Owner sets each employee's daily rate. |
| OQ-2 | Period Mon–Sun, payday Sunday, hours 8:30–5:30. |
| OQ-3 | Daily pool split equally among Mechanics present. |
| OQ-3a | Half-day = no share. Only Mechanics (not Staff/Technicians) earn incentives. |
| OQ-4 | Clawbacks are deductions. |
| OQ-5 | Incentives excluded from 13th month. |
| OQ-6 / 6a | Gov't contributions company-paid, handled by accountant/third party. |
| OQ-7 | 2 HR/Finance staff prepare; Owner has final approval. |
| OQ-8 | Bank transfer only. |
| OQ-9 | Employees tax-exempt; no withholding in system. |
| OQ-10 | Allowances/deductions ad hoc. |
| OQ-11 | ~20 employees. |
| OQ-12 | Owner defines incentive jobs in-app. |
| OQ-13 | No cap on deductions; negative balance carries to next payday. |
| OQ-15 | 1 mandatory rest day/week; rest-day work paid at regular rate; OT after 5:30 PM at +25%. |
| OQ-16 | HR marks half days manually; no lateness/undertime deductions. |
| OQ-18 | Payouts uploaded to RCBC Corporate account. |
| OQ-19 | No holiday premium: worked holiday = regular rate; unworked = no pay. |
| OQ-20 | (2026-09-27) Allowance is a fixed **daily** rate on each employee's pay terms (full day = full, half day = half); not an ad hoc weekly entry. |
| OQ-21 | (2026-09-27) Rest days are not fixed: HR can mark any day as R (day off). |
| OQ-14 | (default) Monthly summaries attribute a week to the month of its Sunday payday. |

## 10. Open questions (remaining)

| ID | Question | Why |
|---|---|---|
| OQ-18a | Blank RCBC Corporate bulk-credit template (needed before the bank-file task). | Bank file |

**Legal note (for the Owner / accountant, not a blocker):** the PH Labor Code (Art. 93) generally requires +30% for work on an employee's rest day, and holiday premiums are also mandated. The system keeps these as editable multipliers so you can change them without code; please confirm with your accountant or labor consultant.

## Hand-off checklist

- [x] Every Must story has Given/When/Then
- [x] Permission matrix covers all roles
- [x] Out-of-Scope list present
- [x] Open Questions answered or explicitly deferred (OQ-18a deferred to bank-file task)
- [x] Human approval: scope signed off (Owner, 2026-09-26)
