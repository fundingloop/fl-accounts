# Architecture (current state) - fl-accounts

What is actually built and running, post the July 2026 remediation. The
future/target design is deliberately kept separate in
[ARCHITECTURE_RECOMMENDATIONS.md](ARCHITECTURE_RECOMMENDATIONS.md).

## System shape

- Standalone Next.js 14 (App Router, plain JS) front end in its own repo and
  Vercel project, served at accounts.fundingloop.au.
- Shares ONE Supabase project with fl-crm and the other Funding Loop portals:
  same auth, same Postgres. fl-accounts owns **no migrations** - every schema
  change ships file-first in `fl-crm/supabase/migrations` and is applied
  manually (`supabase db push`), never from this repo.
- Also shares the project with **fl-people**, which owns the Nepal payroll
  system-of-record (`hr_payroll_runs` / `hr_payroll_items`). fl-accounts holds
  a read-only, append-only finance mirror of each finalised run
  (`payroll_run_snapshots`) plus two SECURITY DEFINER RPCs
  (`accounts_finalised_payroll_runs()`, `accounts_sync_payroll_snapshots()`)
  that gate on `is_accounts_app_user()` and expose only finalised-run headers
  - no per-employee hr data ever crosses into this app. See the split-ownership
  decision in ROADMAP.md. Migration `20260711160000_payroll_run_snapshots.sql`
  (fl-crm ledger) is authored but **not yet applied**.
- All UI pages are client components; data access is the Supabase browser
  client under RLS, except file handling and bill deletion which go through
  server routes.
- CI: GitHub Actions (`.github/workflows/ci.yml`) runs the full gate (npm ci,
  test, lint, build) on every push and pull request.

## Auth & authorisation (three layers)

1. **Middleware** (`middleware.js`): every non-static request needs an
   authenticated session; the caller's own `team_members` row must be active
   with role in (`accounts`, `manager`, `admin`). If the user has a verified
   TOTP factor, the session must be AAL2 (MFA verified) - otherwise they are
   held at /login to complete the challenge. APIs receive 401/403 JSON.
2. **RLS**: the four app tables (`float_accounts`, `bills`, `float_deposits`,
   `payroll_employees`) allow CRUD only to `is_accounts_app_user()`. The
   `accounts` role is excluded from `is_team_member()`/`is_staff()`, so its
   JWT reads nothing in the CRM. `team_members` self-read comes from the
   `rls_team_members_self_read` policy (migration 20260711120000).
   DB backstops: CHECK constraints on amounts/recurrence and the append-only
   `fl_accounts_audit_log` fed by triggers (migration 20260711130000).
   Both migrations are applied to the production Supabase project
   (2026-07-11) - this section describes live behaviour.
   `payroll_run_snapshots` is a fifth table with a deliberately different
   shape: `is_accounts_app_user()` gates SELECT only, write grants are
   revoked from `authenticated`/`anon`, and the only insert path is the
   `accounts_sync_payroll_snapshots()` RPC - no client insert path exists.
   UPDATE/DELETE are blocked by trigger for every role, including
   `service_role`; corrections require a deliberate manual migration, never
   an in-place edit. Not yet live (migration unapplied).
3. **Server routes** re-verify role + bill ownership in code before any
   service-role operation.

## Routes

| Route | Kind | Purpose |
|---|---|---|
| `/login` | page | Password sign-in, then TOTP challenge when the account has a verified factor. Shows access-denied and MFA-pending states. |
| `/` | page | Dashboard: current float, outstanding/overdue/due-soon cards, 6-month forecast chart. Read-only load of `payroll_run_snapshots` (never syncs) folds finalised payroll into the chart, with an honest note stating whether payroll is included. |
| `/bills` | page | Bills CRUD, paid toggle (compare-and-set), attachment upload/view, filters, totals. |
| `/float` | page | Float settings, deposits, reconciliation, re-baseline to actual. |
| `/payroll` | page | Nepal SSF salary register (Rigo-matched maths, reference/estimate only), soft-delete offboarding. Payroll run history section: auto-syncs and lists finance snapshots of finalised fl-people runs, with CSV download; shows an amber banner instead when the snapshot migrations are not yet applied. |
| `/security` | page | MFA: enrol authenticator (QR), verify, remove factor. |
| `POST /api/upload` | route | Attachment upload: role check, bill-ownership check, MIME + magic-byte validation, 15MB cap, service-role storage write, bill update, rollback + replaced-file cleanup. |
| `GET /api/download` | route | Signed URL (60s) only for a path that exactly matches a real bill's current attachment. |
| `POST /api/bills/delete` | route | Deletes the bill under the CALLER'S RLS (durable success point), then best-effort removal of its storage files (logged, never faked). |

## Financial logic

- `lib/forecast.js` - pure, UTC-date-based cashflow maths: current balance
  from baseline + deposits - paid bills; 6-month projection of recurring
  occurrences, unpaid one-offs (overdue clamps to today) and future deposits;
  lowest-point detection. `buildForecast()` takes an optional `extraEvents`
  array (already clipped to [today, horizon] by the caller) that is
  concatenated with bill/deposit events before the sort - a generic hook so
  other projections (payroll) can feed the same series without
  `computeCurrentBalance()` changing. Unit-tested.
- `lib/payroll.js` - Nepal SSF payslip maths matching Rigo HR exactly
  (contribution base = basic only; employer 20% grossed up into income; full
  31% deducted). Unit-tested against the Rigo worked example. Powers the
  `payroll_employees` register, which is a Rigo-matched reference/estimate
  tool - explicitly not a system of record; that role belongs to fl-people.
- `lib/payrollSnapshots.js` - pure helpers for the `payroll_run_snapshots`
  mirror: `isMissingSchemaError()` (tells "migration not applied yet" apart
  from a real error), `periodLabel()`, `latestSnapshot()`, `snapshotCsv()`
  (RFC-4180). Unit-tested.
- `lib/payrollForecast.js` - projects `payroll_run_snapshots` rows into
  `buildForecast()`'s `extraEvents`: known liabilities per finalised period
  (SSF payable on day 15, TDS on day 25 of the following month - a documented
  AD-calendar approximation of Nepal statutory timing, configurable via
  `ssfRemitDay`/`tdsRemitDay`) and net wages when the run's `pay_date` is
  still ahead of today; estimated future months beyond the latest snapshot
  reuse its figures and its pay-date-to-period-end offset.
  `payrollMonthlyCashCost()` helper for the dashboard note. Unit-tested.
- Derived figures are never persisted; every page recomputes from raw rows.
  Fine at current volume; the scaling limits and the ledger-based successor
  are documented in FINANCIAL_SYSTEM_REVIEW.md. `payroll_run_snapshots` is the
  one exception - an append-only mirror of a value that is sealed at source
  (a finalised fl-people run), so mirroring it is not the same risk as
  persisting a derived figure that can drift.

## Storage

Private bucket `account-invoices`, path `{account_id}/{bill_id}/{filename}`,
zero client-side storage policies (deny-all; service-role only via routes).

## Operational invariants

- Honest failures: no route or form reports success after failed persistence;
  forms keep user input on failure.
- Multi-step operations document order / durable success point / rollback in
  a comment at the top of the route.
- The middleware matcher exempts static assets and `/_next/image`; the image
  optimizer itself is disabled (`images.unoptimized`) so that exemption is
  inert.
