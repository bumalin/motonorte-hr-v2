# Motonorte HR & Payroll — Multi-Agent Build

HR & payroll system with incentives for mechanics.
Users: HR Staff, Finance Staff, Company Owner.
Stack: Next.js (App Router) + Tailwind, PostgreSQL 17 (own Docker container, RLS), OpenAI API. Same Docker Compose stack runs locally first, then on the Owner's web server (see docs/03-architecture.md §1, §10). Supabase optional later.
Next.js Route Handlers / Server Actions *are* the backend. Auth is our own (scrypt + DB sessions). All queries go through `withUser()` so Postgres RLS applies.

## Non-negotiable rules (every agent)
- Agents communicate through files in `docs/` and `fixtures/`, not chat. No file = no hand-off.
- Read only your listed inputs; write only your listed outputs.
- Missing or contradictory input → write a `BLOCKED:` section naming the exact gap and stop. Never invent requirements.
- Money: BIGINT cents or NUMERIC(12,2). Never floats. Never computed in the browser.
- **LLMs never compute pay.** Pay is a pure TypeScript module verified by `fixtures/payroll/*.json`. OpenAI is for explanations, report Q&A, anomaly flags only — and never receives bank/tax IDs.
- Simplest design that meets the requirement. No speculative features.
- End every output with its hand-off checklist, items marked `[x]` / `[ ]`.

## Pipeline

| # | Agent | Inputs | Output | Gate |
|---|---|---|---|---|
| 1 | `product-manager` | brief, policies, past payslips | `docs/01-prd.md` | Human |
| 2 | `payroll-domain` | 01, incentive policy, payslips | `docs/02-payroll-rules.md`, `fixtures/payroll/*.json` | Finance/Owner hand-verify fixtures |
| 3 | `system-architect` | 01, 02 | `docs/03-architecture.md` | **Human → Phase 2** |
| 4 | `ux-designer` | 01, 03 | `docs/04-ux-spec.md` | — |
| 5 | `data-architect` | 02, 03, 04 | `db/migrations/*.sql`, `db/seed.sql` | — |
| 6 | `task-planner` | 01–05 | `docs/06-task-queue.md` | **Human → Phase 3** |
| 7 | `developer` | one TASK + referenced docs | code + tests | CI green |
| 8 | `code-reviewer` | TASK diff | `docs/reviews/TASK-###.md` | APPROVE to merge |
| 9 | `qa-tester` | 01, fixtures, app | `docs/07-test-report.md` | — |
| 10 | `security-auditor` | 03, schema, code | `docs/08-security-report.md` | No Critical/High |
| 11 | `release-engineer` | 07, 08 | `docs/09-launch-checklist.md` | **Owner go/no-go** |

Only a human advances a phase.

## Phase 3 loop (orchestrator enforces, not the agents)
For each task in `docs/06-task-queue.md`, in dependency order:
1. `developer` implements TASK-###.
2. Run CI (typecheck, lint, tests, all payroll fixtures). Fail → back to developer; does **not** consume a review round.
3. `code-reviewer` returns a verdict.
4. `APPROVE` → mark task done. `REQUEST_CHANGES` → developer fixes only listed findings, answering each "fixed" or "disputed: <reason>".

**Stop and escalate to the human when:**
- 3 review rounds done without APPROVE, or
- the same blocker (file + issue) appears in two consecutive rounds, or
- developer writes `SCHEMA CHANGE REQUEST` or `BLOCKED:`.

Reviewers may not add scope — out-of-criteria ideas become new tasks in the queue.

## Open questions (answer before Phase 1 sign-off)
- Jurisdiction (overtime, minimum wage, tax withholding, statutory contributions)?
- Pay frequency and period boundaries?
- Currency?
- Current incentive policy for mechanics (flat-rate, efficiency tiers, comebacks, commission)?

@AGENTS.md
