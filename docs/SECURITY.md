# Security Review & Status - fl-accounts (2026-07-11)

Full audit of authentication, authorisation, RLS assumptions, service-role
usage, storage, financial privacy, browser writes, token handling, error
leakage, concurrency, build and dependencies. Every confirmed finding is
ranked and its remediation status tracked here. Architecture-level follow-ons
live in [ARCHITECTURE_RECOMMENDATIONS.md](ARCHITECTURE_RECOMMENDATIONS.md);
accepted debt in [TECH_DEBT.md](TECH_DEBT.md).

## Security model (as built)

- **Front door**: middleware requires an authenticated Supabase session AND an
  active `team_members` row with role in (accounts, manager, admin). APIs get
  401/403 JSON; pages redirect to /login. When the user has a verified TOTP
  factor, the middleware additionally requires an AAL2 session (MFA).
- **Database**: the four fl-accounts tables are RLS-gated by
  `is_accounts_app_user()` (SECURITY DEFINER). The `accounts` role is excluded
  from `is_team_member()`/`is_staff()`, so an accounts JWT reaches no CRM
  data. Financial writes go straight from the browser under RLS (v1 design);
  DB CHECK constraints and an append-only audit journal backstop them.
- **Storage**: private `account-invoices` bucket, zero client policies.
  Upload/download/delete flow only through server routes that re-check role
  and bill ownership before using the service-role key.
- **Cross-app payroll boundary** (2026-07-11, migrations applied the same
  day): fl-people owns the Nepal payroll system-of-record
  (`hr_payroll_runs`/`hr_payroll_items`); fl-accounts holds
  `payroll_run_snapshots`, an append-only finance mirror of finalised runs
  only. No client insert/update/delete path exists - the only writer is the
  `accounts_sync_payroll_snapshots()` SECURITY DEFINER RPC, gated on
  `is_accounts_app_user()`, which re-sums `hr_payroll_items` and refuses to
  snapshot a run whose header totals disagree with its line totals.
  UPDATE/DELETE are blocked by trigger for every role, including
  `service_role` - corrections are a deliberate manual migration, never an
  in-place edit. Reads of fl-people data go only through
  `accounts_finalised_payroll_runs()`, a second SECURITY DEFINER RPC also
  gated on `is_accounts_app_user()`, which exposes finalised-run headers
  (period + totals) only - no per-employee hr data ever crosses into
  fl-accounts. Every snapshot insert is captured in `fl_accounts_audit_log`
  like any other fl-accounts financial write.
- **Multi-entity foundation** (authored 2026-07-11, migrations **not yet
  applied** - `20260711220000_fin_entities.sql` then
  `20260711230000_fin_bank_accounts.sql`, fl-crm ledger): three new tables,
  same `is_accounts_app_user()` boundary as every existing fl-accounts
  table.
  - `fin_entities`: SELECT/INSERT/UPDATE gated on `is_accounts_app_user()`;
    no DELETE policy; a guard trigger additionally rejects every DELETE and
    any UPDATE that changes the frozen `code` column, for every role
    including `service_role` (triggers fire regardless of RLS bypass).
  - `fin_bank_accounts`: same SELECT/INSERT/UPDATE shape; a guard trigger
    rejects DELETE (close via `status='closed'` instead) and any UPDATE that
    moves the row's `entity_id` to a different entity.
  - `fin_transfers`: a single `FOR ALL` policy gated on
    `is_accounts_app_user()` covering SELECT/INSERT/UPDATE/DELETE; a guard
    trigger derives `from_entity_id`/`to_entity_id` from the bank accounts
    (never client-supplied), enforces the `planned -> in_transit -> settled
    | cancelled` status machine, makes a settled transfer immutable (no
    further UPDATE, for every role), and restricts DELETE to
    planned/cancelled rows only.
  - `entity_id` is retrofitted (NOT NULL) onto `float_accounts`, `bills`,
    `float_deposits`, `payroll_employees` and `payroll_run_snapshots`; a
    derive trigger fills it from the parent float account when a caller
    omits it (keeping an already-deployed app version working) and rejects
    it outright when a caller supplies a value that contradicts the parent's
    entity (cross-entity rows are refused, not silently corrected).
    `accounts_sync_payroll_snapshots()` is re-created to stamp `entity_id`
    and now refuses to capture a run whose `entity_code` has no registered
    `fin_entities` row.
  - **Account number masking**: `fin_bank_accounts.account_number` is stored
    in full (a payment routing detail, same sensitivity class as a BSB, not
    a secret credential) and is always rendered masked in the UI
    (`maskAccountNumber()` - last 4 digits only). RLS still restricts reads
    of the underlying row to accounts-app users regardless.
  - See [ENTITY_MODEL.md](ENTITY_MODEL.md) and
    [BANK_ACCOUNT_MODEL.md](BANK_ACCOUNT_MODEL.md) for the full design.
    **Manual action required: apply both migrations** (see ROADMAP.md for
    the pre/post verification blocks); until then the app runs its
    pre-migration fallback (a single virtual entity, amber "not applied yet"
    banners on `/entities`, `/banking`, `/transfers`).

## Entity isolation posture

There is **one accounts-role security boundary today, not a per-entity
one**: `is_accounts_app_user()` gates every fl-accounts table (including the
three new `fin_` tables above) uniformly, and RLS does **not** partition
access by entity. Any user with the `accounts`/`manager`/`admin` role can
read and write every entity's rows - a Nepal-only clerk can see AU payroll
and vice versa, once both entities exist. This is an accepted, explicit gap
for this milestone: per-entity authorisation (a membership table consumed by
RLS, as recommended in ARCHITECTURE_RECOMMENDATIONS.md's non-schema
recommendations) remains a Phase 3+ roadmap item. Until then, cross-entity
access is an **application-level** concern (the entity switcher scopes what
a user is *shown*, not what they are *authorised* to see) - not a database
one.

## Findings register

Severities: Critical / High / Medium / Low / Informational.
Status: Fixed (this review), Mitigated, Documented (accepted for v1), Manual
action required.

### High

| # | Finding | Status |
|---|---|---|
| H1 | **`accounts` role locked out by RLS**: `team_members` had no self-read policy and `is_team_member()` excludes `accounts`, so the middleware role lookup returned nothing for the app's primary role - a fail-closed lockout of the intended user. | Fixed - migration `20260711120000_team_members_self_read.sql` (fl-crm ledger, additive SELECT-only self-read). **Applied to the production Supabase project 2026-07-11.** |
| H2 | **No MFA** on a finance app holding payroll PII, with password-only login. | Fixed in-app - TOTP enrollment page (/security), login challenge step, middleware AAL2 enforcement for enrolled users. **Manual action: ensure TOTP is enabled in Supabase Auth settings; then enrol each user. Enforcement is automatic once a user has a verified factor. Org-wide *mandatory* enrollment is a policy decision - see TECH_DEBT.** |
| H3 | **Known Next.js advisories in 14.2.35** (highest: unauthenticated DoS via the image-optimizer endpoint, which the auth middleware deliberately exempts). | Mitigated - `images.unoptimized: true` disables the optimizer endpoint (the app never uses next/image); `poweredByHeader` off; security headers added. Major-version upgrade tracked in TECH_DEBT (no non-breaking fix exists inside 14.x). |

### Medium

| # | Finding | Status |
|---|---|---|
| M1 | No audit trail on any financial table; edits/deletes silently rewrote history. | Fixed - `20260711130000_fl_accounts_integrity.sql`: append-only `fl_accounts_audit_log` (trigger-fed, SECURITY DEFINER, admin-read, no client writes). **Applied to the production Supabase project 2026-07-11.** |
| M2 | Hard deletes destroyed financial history: payroll rows deleted outright (despite an `active` column); deleting a bill orphaned its attachment files forever. | Fixed - payroll delete is now a soft-delete (`active=false`, register filters on active); bill deletion moved to `POST /api/bills/delete` which deletes the row under the caller's RLS (durable success point) then best-effort-removes the bill's storage files, logging any cleanup failure. |
| M3 | No DB-level validation: any accounts-app JWT could write negative amounts or recurrence-less recurring bills straight through PostgREST. | Fixed - CHECK constraints (NOT VALID then VALIDATE) in `20260711130000_fl_accounts_integrity.sql`. **Applied to the production Supabase project 2026-07-11.** |
| M4 | Upload flow orphaned storage objects: replaced attachments left the old file forever; a failed DB update after a successful upload left an orphan and no rollback. | Fixed - upload route now validates magic bytes, rolls back the uploaded object if the bill update fails (honest 500, no fake success), and removes the replaced file after a successful swap. Operation order / durable success point documented in the route. |
| M5 | Lost-update race on the bill paid toggle: update built from stale client state, last write wins with no detection. | Fixed - compare-and-set (`.eq("paid", previous)`); zero-row result surfaces a conflict message and refreshes. |
| M6 | Raw Supabase/storage error messages returned to clients from API routes (internal detail leakage). | Fixed - server routes log the real error and return generic messages. |
| M7 | No security response headers; X-Powered-By advertised. | Fixed - nosniff, X-Frame-Options DENY, Referrer-Policy, HSTS, Permissions-Policy via next.config; poweredByHeader off. |
| M8 | Currency change on the float account silently relabels all historical amounts (no conversion). | Mitigated - explicit confirmation dialog spelling out the consequence. Real fix (FX-aware model) is Phase-2 architecture. |
| M9 | Payroll run history and payroll-in-forecast are built and unit-tested; the migrations that make them live have now been applied. | **Fixed at schema/app level - applied 2026-07-11.** `20260711150000_hr_payroll_foundation.sql` then `20260711160000_payroll_run_snapshots.sql` (fl-crm ledger, apply order mattered - the second has a foreign key to the first's `hr_payroll_runs`) were applied to the production Supabase project in that order, and each migration's post-apply verification block passed. `payroll_run_snapshots` and its two RPCs are live. **Manual action remaining: live verification checklist at accounts.fundingloop.au** - finalise a supervised run in fl-people and confirm: first sync captures each finalised run once, second sync captures zero, totals match fl-people, no employee-level data is visible, non-accounts users are rejected by both RPCs, UPDATE/DELETE are rejected, and the capture lands in `fl_accounts_audit_log`. (The graceful-degradation path - amber banner on /payroll, "not included" note on the dashboard - remains in the code as a resilience guard if the schema were ever missing, but is not the current state.) |

### Low

| # | Finding | Status |
|---|---|---|
| L1 | `fl-accounts.zip` (full source snapshot) tracked in git; HEAD commit consisted solely of it. Verified to contain no secrets (.env.local not inside). | Fixed - removed from the tree (history untouched; nothing sensitive to purge). |
| L2 | No tests at all; forecast/payroll correctness asserted only in comments. | Fixed - vitest suite covering forecast maths, payroll (Rigo worked example), and formatters; `npm test` wired up. The suite now runs in GitHub Actions CI on every push and pull request. |
| L3 | No ESLint config (`next lint` was unconfigured). | Fixed - `next/core-web-vitals` config added; lint clean and enforced in CI. |
| L4 | Fonts loaded from Google Fonts at runtime (render-blocking, availability + privacy dependency). | Fixed - self-hosted via `next/font/google`. Favicon still loads from fundingloop.com.au (documented, cosmetic). |
| L5 | `useFloatAccount` picked an arbitrary row (`limit(1)` without order) - non-deterministic if a second float account ever exists. | Fixed - deterministic oldest-first ordering. |
| L6 | Failed saves wiped user input (bills form closed on error; deposit/re-baseline forms reset on error) - ambiguous failure UX on financial entry. | Fixed - all forms stay open with values intact on failure; only success closes/reloads. |
| L7 | Upload trusted the browser-declared MIME type. | Fixed - magic-byte verification for PDF/PNG/JPEG/WEBP/GIF (bundled with M4). |

### Informational

| # | Finding | Status |
|---|---|---|
| I1 | `discovery_rules` keeps an open `USING(true)` read policy in the shared project (call-script config, not customer data) - readable by accounts users. | Accepted residual, noted in the fl_accounts migration itself. |
| I2 | Comment drift: `20260707100000_payroll.sql` describes SSF on "basic+DA"; the implemented (and Rigo-matching) base is basic only. Applied migrations are immutable - drift noted here. | Documented. |
| I3 | No rate limiting on the app's own API routes (upload/download/delete). All are authenticated-and-role-gated; Supabase applies its own limits to auth endpoints (login/MFA). In-memory limiting is ineffective on serverless. | Documented - revisit if routes multiply (TECH_DEBT). |
| I4 | CSRF: state-changing routes are cookie-authenticated; Supabase SSR cookies are SameSite=Lax, which blocks cross-site POSTs; download is a GET but read-only per-request. | No action needed; noted for future route authors: keep state changes on POST. |
| I5 | Shared Supabase project = shared blast radius with the CRM and portals. | Documented - isolation criteria in ARCHITECTURE_RECOMMENDATIONS. |
| I6 | The file headers of `20260711150000_hr_payroll_foundation.sql` and `20260711160000_payroll_run_snapshots.sql` (fl-crm ledger) still read "NOT YET APPLIED" - now historical. Applied migrations are immutable (see I2, TECH_DEBT D10), so the header text is not updated after the fact; applied status is recorded here and in ROADMAP.md instead. | Documented. Both migrations were applied to production 2026-07-11 (see M9). |

## Standing rules for contributors

1. Never import `lib/supabase-server.js` (service role) into anything reachable
   by the browser; every service-role route re-checks role + ownership first.
2. Never return success after failed persistence; log the internal error,
   return a generic message.
3. Multi-step financial operations must state their operation order, durable
   success point, rollback and audit behaviour in a comment at the top of the
   route (see upload and bills/delete routes for the pattern).
4. Schema changes: file-first migrations in fl-crm's ledger with pre-apply
   checks, post-apply verification and rollback SQL. Never applied
   automatically from this repo.
5. Cross-app reads of hr payroll data (or any other sibling app's data) are
   only ever exposed through a SECURITY DEFINER helper that gates on
   `is_accounts_app_user()` and returns headers/aggregates only - never a
   direct RLS grant onto the other app's tables, and never per-employee or
   otherwise granular records. `accounts_finalised_payroll_runs()` is the
   reference implementation.
