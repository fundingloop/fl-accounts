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
  (fl-crm ledger), after `20260711150000_hr_payroll_foundation.sql`, was
  **applied to the production Supabase project 2026-07-11** (post-apply
  verification passed for both); live end-to-end verification at
  accounts.fundingloop.au is still outstanding.
- All UI pages are client components; data access is the Supabase browser
  client under RLS, except file handling and bill deletion which go through
  server routes.
- CI: GitHub Actions (`.github/workflows/ci.yml`) runs the full gate (npm ci,
  test, lint, build) on every push and pull request.
- **Multi-entity foundation** (authored, not applied - see below): a root
  `EntityProvider` (`lib/useEntities.js`, mounted via
  `components/Providers.js`) loads the `fin_entities` registry once and
  exposes `currentEntity` / `allSelected` / `selection` to every page.
  `EntitySwitcher` (rendered in `AppShell`'s sidebar) lets a user pick one
  entity or "All entities", persisted to `localStorage`. Pre-migration, or
  when "All entities" is selected, the provider falls back to a single
  virtual entity built from the one legacy `float_accounts` row so the app
  keeps working exactly as it did pre-milestone. See
  [ENTITY_MODEL.md](ENTITY_MODEL.md).

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
   an in-place edit. Live since 2026-07-11 (post-apply verification passed);
   live end-to-end verification at accounts.fundingloop.au is still
   outstanding.

   **Not yet live**: two further migrations,
   `20260711220000_fin_entities.sql` and
   `20260711230000_fin_bank_accounts.sql` (fl-crm ledger, apply order
   matters - the second has FKs to the first's `fin_entities`), are authored
   and committed to the ledger but **not applied** to the production
   Supabase project. They add `fin_entities` (legal entity registry, RLS
   gated on `is_accounts_app_user()`, no DELETE policy, archive-only via a
   guard trigger that fires for every role including `service_role`),
   `fin_bank_accounts` (per-entity bank account registry, same RLS shape,
   close-not-delete guard, frozen `entity_id`) and `fin_transfers` (transfer
   workflow between bank accounts, `FOR ALL` policy gated on
   `is_accounts_app_user()`, settled-immutable by trigger), plus a NOT NULL
   `entity_id` retrofit onto `float_accounts`/`bills`/`float_deposits`/
   `payroll_employees`/`payroll_run_snapshots` with a derive-trigger that
   keeps an already-deployed app version working. See
   [ENTITY_MODEL.md](ENTITY_MODEL.md) and
   [BANK_ACCOUNT_MODEL.md](BANK_ACCOUNT_MODEL.md) for the full design; the
   app degrades gracefully via `isMissingSchemaError()` until these are
   applied.
3. **Server routes** re-verify role + bill ownership in code before any
   service-role operation.

## Routes

| Route | Kind | Purpose |
|---|---|---|
| `/login` | page | Password sign-in, then TOTP challenge when the account has a verified factor. Shows access-denied and MFA-pending states. |
| `/` | page | Dashboard: single-entity view (current float, outstanding/overdue/due-soon cards, 6-month forecast chart, forecast summary card, upcoming payroll/bills/tax/transfers) when one entity is selected; a group view (per-entity cards + per-currency-only group totals, never summed across currencies) when "All entities" is selected. Read-only load of `payroll_run_snapshots` (never syncs) folds finalised payroll into the chart, with an honest note stating whether payroll is included. See [FORECAST_MODEL.md](FORECAST_MODEL.md). |
| `/bills` | page | Bills CRUD, paid toggle (compare-and-set), attachment upload/view, filters, totals. Entity-aware: single-entity view scoped to the selected entity's float account, or an all-entities view. |
| `/float` | page | Float settings, deposits, reconciliation, re-baseline to actual. Entity-aware via `useFloatAccount()`. |
| `/payroll` | page | Nepal SSF salary register (Rigo-matched maths, reference/estimate only), soft-delete offboarding. Payroll run history section: auto-syncs and lists finance snapshots of finalised fl-people runs, with CSV download; falls back to an amber banner instead as a graceful-degradation path if the snapshot schema were ever missing (not the current state - the migrations are applied). Entity-aware: scoped to the selected entity, or shows an Entity column across all when "All entities" is selected. |
| `/banking` | page | `fin_bank_accounts` registry CRUD: add/edit bank accounts per entity, close (not delete), masked account numbers, primary-account flag. Amber banner if the bank account migration is not yet applied (current state). |
| `/transfers` | page | `fin_transfers` workflow: create a transfer between two bank accounts, advance its status (planned -> in_transit -> settled, or cancel), intercompany badge. Amber banner if not yet applied (current state). |
| `/entities` | page | `fin_entities` registry CRUD: add/edit entities, archive/restore (no hard delete). Amber banner if not yet applied (current state). |
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
  `computeCurrentBalance()` changing. Also exports `forecastSummary()`, a
  pure aggregation of a forecast's `events` into opening/income/expenses/
  payroll/tax/closing/other buckets, powering the dashboard's forecast
  summary card and the group view's per-entity "forecast closing" figure.
  Unit-tested. See [FORECAST_MODEL.md](FORECAST_MODEL.md).
- `lib/payroll.js` - Nepal SSF payslip maths matching Rigo HR exactly
  (contribution base = basic only; employer 20% grossed up into income; full
  31% deducted). Unit-tested against the Rigo worked example. Powers the
  `payroll_employees` register, which is a Rigo-matched reference/estimate
  tool - explicitly not a system of record; that role belongs to fl-people.
- `lib/payrollSnapshots.js` - pure helpers for the `payroll_run_snapshots`
  mirror: `isMissingSchemaError()` (a resilience guard - distinguishes a
  missing-schema error from a real error, so the UI can degrade gracefully
  if the snapshot schema were ever absent), `periodLabel()`,
  `latestSnapshot()`, `snapshotCsv()` (RFC-4180), and `snapshotsForEntity()`
  (scopes snapshot rows to the selected entity via `entity_id`, falling back
  to `entity_code` for rows written before the `entity_id` retrofit).
  Unit-tested.
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
