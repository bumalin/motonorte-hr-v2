# Payroll Rules — Motonorte

Status: **v2 — F01–F23, T01 approved 2026-09-26; PR-021/022/060/062 amended and F24–F26 approved by the Owner 2026-09-27; PR-055 and F27–F28 approved by the Owner 2026-09-28**
Owner agent: payroll-domain · Date: 2026-09-26 · Source: `docs/01-prd.md` v2 (approved)

Every rule has an ID. Code, tests, UI drill-downs, and reviews cite these IDs.
Fixtures: `fixtures/payroll/weekly.json`, `fixtures/payroll/thirteenth-month.json`.

---

## A. Units & rounding

**PR-001 Money.** All amounts are integer **centavos** (₱650.00 = `65000`). No floats anywhere in the calculation.

**PR-002 Rounding.** Each *line item* (one day's base pay, one day's OT, one incentive share) is rounded **half-up** to the centavo once, at the point it's computed. Totals are sums of rounded line items and are never re-rounded.

**PR-003 Time zone.** All dates are calendar dates in `Asia/Manila`.

## B. Pay period

**PR-010 Period.** Monday through Sunday (7 days). **Payday** = the Sunday that ends the period.

**PR-011 Attribution.** A period belongs to the month and year of its payday (used for the monthly summary and 13th month).

## C. Employees & attendance

**PR-020 Positions.** `staff`, `mechanic`, `technician`. Position, daily rate and daily allowance are **effective-dated** together (`pay_terms`: position, daily_rate, daily_allowance, effective_from). The terms in effect **on each calendar day** apply to that day.

**PR-021 Usual rest day.** Each employee has a usual weekly rest day (e.g. Sunday). It is the default for "Fill empty cells" and the day the rest-day multiplier (PR-030) applies to. *(Amended by Owner 2026-09-27: rest days are not fixed — see PR-022.)*

**PR-022 Day status.** HR records exactly one status per employee per day:

| Code | Meaning |
|---|---|
| `F` | Full day worked |
| `H` | Half day worked |
| `A` | Not worked (absent, or holiday not worked) |
| `R` | Rest day / day off, not worked — **any day** (Owner 2026-09-27: HR marks whichever day a mechanic is off) |
| `-` | Not employed that day (before hire date / after end date) — system-derived, not entered |

Working on the rest day = `F` or `H` on that day. There are no lateness/undertime deductions.

**PR-023 Completeness.** Every employed day of every active employee must have a status before a draft can be generated. Missing entry → error `MISSING_ATTENDANCE` (employee, date). No silent defaults.

## D. Base pay

**PR-030 Day multiplier** (settings, editable by Owner; current values):

| Setting | Value | Applies to |
|---|---|---|
| `rest_day_worked_multiplier` | 1.00 | `F`/`H` on the employee's usual rest day (PR-021) |
| `holiday_worked_multiplier` | 1.00 | `F`/`H` on a date in the holiday calendar |
| `holiday_unworked_multiplier` | 0.00 | `A` on a holiday date |
| `ot_multiplier` | 1.25 | overtime hours |

If a day is both the usual rest day and a holiday, the worked multipliers are **multiplied** together.

**PR-031 Base pay per day.**
- `F` → `round(rate × day_multiplier)`
- `H` → `round(rate × 0.5 × day_multiplier)`
- `A` on a holiday → `round(rate × holiday_unworked_multiplier)`
- `A` (non-holiday), `R`, `-` → 0

**PR-032 Basic pay per day** (used for 13th month only): `F` → `rate`, `H` → `round(rate × 0.5)`, otherwise 0. Never includes multipliers, OT, incentives, allowances, or unworked-holiday pay.

## E. Overtime

**PR-040 OT pay.** Only on `F` days. HR enters OT as whole minutes worked after 5:30 PM.
`ot_pay = round(rate × ot_minutes × ot_multiplier × day_multiplier ÷ 480)` (480 = 8 h × 60 min).
Example: ₱650 rate, 120 min → 65000 × 120 × 1.25 ÷ 480 = 20312.5 → **20313** (₱203.13).

**PR-041** OT minutes on a non-`F` day → error `INVALID_OT`.

## F. Incentives (daily pool)

**PR-050 Catalog.** Incentive jobs have a code, name, amount (centavos), and are **effective-dated**. The amount in effect on the job's date applies.

**PR-051 Daily pool.** `pool(day) = Σ (qty × amount)` over all incentive jobs logged for that day.

**PR-052 Eligibility.** Employees whose position that day is `mechanic` **and** whose status that day is `F`. `H`, `A`, `R` mechanics and all staff/technicians are not eligible.

**PR-053 Split.** With `n` eligible mechanics: `share = floor(pool ÷ n)`; the remainder `r = pool − share × n` (always < n centavos) is given **1 centavo each to the first `r` eligible mechanics ordered by employee code ascending**. Shares always sum exactly to the pool.

**PR-055 Jobs for one mechanic (Owner, 2026-09-28).** Each incentive job is either shared (the daily pool, PR-051) or set to one specific mechanic. A job set to a mechanic is credited to them automatically when logged; they earn qty × amount in full, whatever their attendance that day (F, H, A or R), as long as they are employed that day. It is not part of the day's pool. They still take their normal pool share on full days. The mechanic is recorded on each log entry, so changing the job's setting later doesn't move entries already logged.

**PR-054 No eligible mechanic.** `pool(day) > 0` and `n = 0` → error `NO_ELIGIBLE_MECHANIC` (date). HR must fix attendance or the job log.

## G. Allowances, deductions, carry-over

**PR-060 Adjustments.** Ad hoc entries per employee per period, each with amount, type (cash advance, clawback, correction, other) and reason. **New entries are deductions only** (Owner 2026-09-27: allowance is a fixed rate, PR-062); `allowance` adjustments already recorded still count. Clawbacks never change past pools or locked runs.

**PR-062 Daily allowance.** Each employee's pay terms carry a fixed `daily_allowance` (default ₱0), effective-dated with the rate (PR-020). Per day: `F` → `daily_allowance`; `H` → `round(daily_allowance × 0.5)`; `A`, `R`, `-` → 0. Not multiplied by rest-day or holiday multipliers. Counted in `allowances` (PR-061); **excluded from basic and the 13th month** (PR-032, PR-080). *(Added by Owner 2026-09-27.)*

**PR-061 Totals.**
```
gross     = base + ot + incentive + allowances      (allowances = daily allowance PR-062 + allowance adjustments)
net_raw   = gross − deductions − carried_in
net       = max(0, net_raw)
carry_out = max(0, −net_raw)
```
No cap on deductions. `carry_out` becomes the next period's `carried_in`.

## H. Locking

**PR-070 Determinism.** Same inputs → same outputs to the centavo, every time.

**PR-071 Lock.** Once the Owner approves, the run and its source attendance/jobs/adjustments are immutable. Corrections are new adjustments in a later run.

**PR-073 Reopen (Owner, 2026-09-28).** The Owner may reopen only the most recent locked week, giving a reason (kept on the run and in the audit log). It returns to draft; later drafts that used its carry-over become stale, and later weeks can't be locked until it is locked again. Money already paid through the bank for that week is outside the system: pay any difference separately.

**PR-063 Back pay (Owner, 2026-09-28).** The only addition adjustment: money missed in an already-locked week, entered by the Owner on an open week (type back_pay, added to allowances). All other adjustments are deductions (PR-060). Back pay is not part of basic, so it is excluded from the 13th month (PR-080). Enforced in the database (013).

**PR-072 Historical weeks (Owner, 2026-09-27).** A payroll may be generated for any past week whose own run isn't submitted or locked, including weeks before the latest locked week. Locked weeks stay untouched: a backdated rate, incentive amount or multiplier is refused if it would change a locked week, and a historical week can't be locked if its deductions exceed its pay while later weeks are already locked (the balance could never be deducted). A week can't be locked while an earlier week has an unlocked run; a backfilled week never deducts a balance that a later locked week already deducted. An employee's hire date may move earlier (never later) after they've been paid; their starting pay terms move with it (migration 009).

## I. 13th month

**PR-080** `thirteenth = round(Σ basic ÷ 12)` over all locked runs whose payday falls in the calendar year (PR-011, PR-032). Incentives, OT, allowances, multipliers, and unworked-holiday pay are excluded.

## J. Out of scope (per PRD)

Government contributions (SSS, PhilHealth, Pag-IBIG) and withholding tax — handled by the accountant/third party. The system only exports monthly totals per employee (by payday month, PR-011).

## Legal questions for a human

- Rest-day work at 1.00× and holidays with no premium/pay differ from PH Labor Code defaults (rest day +30%; regular holiday 200% worked / 100% unworked; special day 130%). Kept as editable settings — **confirm with accountant/labor consultant.**
- 13th-month "basic salary" excludes incentives per Owner decision — confirm with accountant.

---

## Fixture index

| ID | Name | Rules |
|---|---|---|
| F01 | Staff full week | PR-031 |
| F02 | Half day | PR-031 |
| F03 | Absent day | PR-031 |
| F04 | Rest day worked at regular rate | PR-030, 031 |
| F05 | Overtime rounding | PR-040, 002 |
| F06 | Single mechanic gets whole pool | PR-051–053 |
| F07 | Pool split 3 ways, multiple job types | PR-051, 053 |
| F08 | Half-day mechanic excluded | PR-052 |
| F09 | Staff and technician excluded | PR-052 |
| F10 | Remainder centavo to lowest code | PR-053 |
| F11 | No eligible mechanic → error | PR-054 |
| F12 | Different pools on different days | PR-051–053 |
| F13 | Mechanic working rest day shares pool | PR-052, 030 |
| F14 | Allowance + deduction | PR-060, 061 |
| F15 | Clawback exceeds pay → carry-over | PR-061 |
| F16 | Carried-in balance deducted | PR-061 |
| F17 | Daily rate changes mid-week | PR-020 |
| F18 | Incentive amount changes mid-week | PR-050 |
| F19 | Holiday worked / unworked (current settings) | PR-030, 031, 032 |
| F20 | Legal multipliers (settings changed) | PR-030, 031, 032 |
| F21 | New hire mid-week | PR-022, 023 |
| F22 | Missing attendance → error | PR-023 |
| F23 | OT on half day → error | PR-041 |
| F24 | Daily allowance: full, half, absent, rest, OT day | PR-062 |
| F25 | Rest day (R) on a non-usual day; working the usual rest day | PR-021, 022, 062 |
| F26 | Daily allowance changes mid-week with the rate | PR-020, 062 |
| F27 | Job for one mechanic paid in full on their half day; pool split among full-day mechanics | PR-052, 053, 055 |
| F28 | Job for one mechanic paid while they were absent; they still share the pool on full days | PR-052, 053, 055 |
| T01 | 13th month, year attribution by payday | PR-080, 011 |

## Hand-off checklist

- [x] Every incentive in the PRD has a formula + ≥2 fixtures (pool: F06–F13, F18)
- [x] Rounding rule stated (PR-002, PR-053)
- [x] Legal questions flagged
- [x] Human approval: fixtures approved by Owner (2026-09-26)
