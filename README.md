# Motonorte HR & Payroll

Weekly payroll for Motonorte, a motorcycle service shop in the Philippines. It records attendance and incentive jobs, computes pay to the centavo, routes each week through Owner approval and prints payslips.

- **Pay period:** Monday to Sunday, paid on Sunday. Each employee has a daily rate and an optional daily allowance.
- **Incentives:** each job is either shared or credited to one specific mechanic.
  - Shared jobs go into a daily pool, split equally among the mechanics who worked a full day.
  - A job set to one mechanic is paid to that mechanic in full.
- **Workflow:** attendance → incentive jobs → generate draft → submit → Owner approves and locks → payslips.
- **Users:** HR/Finance staff, plus the Owner who gives final approval. The Owner chooses which tabs each staff user can open.
- **History:** past weeks can be entered. The Owner can reopen the latest locked week or add back pay.

The exact pay rules (PR-###) and their worked examples are in [docs/02-payroll-rules.md](docs/02-payroll-rules.md).

## Stack

- **App:** Next.js 16 (App Router, Server Actions), React 19, Tailwind CSS v4, TypeScript run directly by Node 24.
- **Database:** PostgreSQL 17 with raw SQL via `postgres`. Row-level security, triggers and locked-week guards live in `db/migrations`.
- **Pay engine:** `lib/payroll/engine.ts`. It's pure and deterministic, uses integer centavos and is checked against golden fixtures in `fixtures/payroll`.
- **Deployment:** Docker Compose with Caddy (HTTPS) and nightly encrypted backups (`age`).

## Run it locally

Requires Node 24 and Docker.

```bash
cp .env.example .env              # then replace every value
docker compose up -d db           # PostgreSQL only
npm install
npm run db:migrate
npm run db:seed                   # optional sample data
npm run dev                       # http://localhost:3000
```

Create a sign-in account. The password is read from an environment variable, so it never appears on screen or in shell history:

```bash
OWNER_PW='a-long-password' npm run create-user -- --email you@example.com --name "Your Name" --role owner --password-env OWNER_PW
```

## Tests

```bash
npm test             # pay engine and golden fixtures (+ DB loader test when DATABASE_URL_OWNER is set)
npm run db:verify    # RLS, lock and integrity checks inside a rolled-back transaction
npm run typecheck
npm run lint
npm run test:e2e     # Playwright, against a separate motonorte_e2e database
```

## Deploy

The `prod` Compose profile adds the app, a one-shot migration step, Caddy and the backup service:

```bash
docker compose --profile prod up -d --build
```

Database migrations run automatically before the app starts.

- **Office PC (local network, internal certificate):** [docs/runbook-office.md](docs/runbook-office.md)
- **VPS with a domain:** [docs/runbook.md](docs/runbook.md)

Never commit `.env`, backups or keys. They are in `.gitignore`.

## Project layout

```
app/            pages and Server Actions (one folder per tab)
components/     shared UI
lib/payroll/    pay engine, types, provenance text
lib/db/         database client, period loader, reports, error messages
lib/auth/       sessions, passwords, tab access
db/migrations/  schema, RLS, triggers (applied in order)
db/tests/       verify.sql
fixtures/       golden payroll cases
tests/e2e/      Playwright end-to-end tests
docs/           PRD, payroll rules, architecture, UX spec, runbooks, reviews
```

## Docs

| File | What it covers |
|---|---|
| [01-prd.md](docs/01-prd.md) | Scope, users, decisions |
| [02-payroll-rules.md](docs/02-payroll-rules.md) | Pay rules and fixture index |
| [03-architecture.md](docs/03-architecture.md) | Components, security model, ADRs |
| [04-ux-spec.md](docs/04-ux-spec.md) | Screens and flows |
| [06-task-queue.md](docs/06-task-queue.md) | Tasks and backlog |
| [07-test-report.md](docs/07-test-report.md) · [08-security-report.md](docs/08-security-report.md) · [09-launch-checklist.md](docs/09-launch-checklist.md) | QA, security, launch |

All rights reserved.

## Employee portal and current release

Administrators create linked employee accounts under **Team members** by adding the existing employee's email. No email invitation is sent. Share the one-use, 7-day activation code privately; the employee activates the account and chooses a password. Administrators select exactly which office or personal tabs each account can access. Attendance editing remains administrator-only.

Employees can view their own profile and approved earnings, and request a weekly, monthly or custom-range payslip. Each PDF download requires fresh administrator approval. Monthly documents begin with combined category totals, including when only one approved week exists; missing approved paydays are marked as a partial month. Complete weeks are included by scheduled payday. Historical approvals remain frozen. The 13th-month estimate is excluded from printed payslips.

Current local installation: http://localhost:3005, Compose project `motonorte-office`. Existing installations must preserve `.env` and the PostgreSQL volume: do not rerun seed/reset or replace credentials. Back up and restore-test before migrations. Never run `docker compose down -v`.

GitHub CI uses a fresh `motonorte_integrity_test` database and serializes database tests so the guarded payroll/auth/portal regressions run without being skipped. Do not run those tests against a live database. Migration files are preserved byte-for-byte because their checksums are enforced.

Release evidence and rollback guidance: [monthly payslips](docs/MONTHLY-PAYSLIPS-2026-10-10.md), [employee portal](docs/EMPLOYEE-PORTAL-2026-10-10.md), and [print design](docs/PAYSLIP-DESIGN-2026-10-10.md). VPS deployment is pending; known dependency security findings must be patched and revalidated before public service access.
