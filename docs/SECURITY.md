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

## Findings register

Severities: Critical / High / Medium / Low / Informational.
Status: Fixed (this review), Mitigated, Documented (accepted for v1), Manual
action required.

### High

| # | Finding | Status |
|---|---|---|
| H1 | **`accounts` role locked out by RLS**: `team_members` had no self-read policy and `is_team_member()` excludes `accounts`, so the middleware role lookup returned nothing for the app's primary role - a fail-closed lockout of the intended user. | Fixed - migration `20260711120000_team_members_self_read.sql` (fl-crm ledger, additive SELECT-only self-read). **Manual action: apply via `supabase db push`.** |
| H2 | **No MFA** on a finance app holding payroll PII, with password-only login. | Fixed in-app - TOTP enrollment page (/security), login challenge step, middleware AAL2 enforcement for enrolled users. **Manual action: ensure TOTP is enabled in Supabase Auth settings; then enrol each user. Enforcement is automatic once a user has a verified factor. Org-wide *mandatory* enrollment is a policy decision - see TECH_DEBT.** |
| H3 | **Known Next.js advisories in 14.2.35** (highest: unauthenticated DoS via the image-optimizer endpoint, which the auth middleware deliberately exempts). | Mitigated - `images.unoptimized: true` disables the optimizer endpoint (the app never uses next/image); `poweredByHeader` off; security headers added. Major-version upgrade tracked in TECH_DEBT (no non-breaking fix exists inside 14.x). |

### Medium

| # | Finding | Status |
|---|---|---|
| M1 | No audit trail on any financial table; edits/deletes silently rewrote history. | Fixed - `20260711130000_fl_accounts_integrity.sql`: append-only `fl_accounts_audit_log` (trigger-fed, SECURITY DEFINER, admin-read, no client writes). **Manual action: apply migration.** |
| M2 | Hard deletes destroyed financial history: payroll rows deleted outright (despite an `active` column); deleting a bill orphaned its attachment files forever. | Fixed - payroll delete is now a soft-delete (`active=false`, register filters on active); bill deletion moved to `POST /api/bills/delete` which deletes the row under the caller's RLS (durable success point) then best-effort-removes the bill's storage files, logging any cleanup failure. |
| M3 | No DB-level validation: any accounts-app JWT could write negative amounts or recurrence-less recurring bills straight through PostgREST. | Fixed - CHECK constraints (NOT VALID then VALIDATE) in `20260711130000_fl_accounts_integrity.sql`. **Manual action: apply migration.** |
| M4 | Upload flow orphaned storage objects: replaced attachments left the old file forever; a failed DB update after a successful upload left an orphan and no rollback. | Fixed - upload route now validates magic bytes, rolls back the uploaded object if the bill update fails (honest 500, no fake success), and removes the replaced file after a successful swap. Operation order / durable success point documented in the route. |
| M5 | Lost-update race on the bill paid toggle: update built from stale client state, last write wins with no detection. | Fixed - compare-and-set (`.eq("paid", previous)`); zero-row result surfaces a conflict message and refreshes. |
| M6 | Raw Supabase/storage error messages returned to clients from API routes (internal detail leakage). | Fixed - server routes log the real error and return generic messages. |
| M7 | No security response headers; X-Powered-By advertised. | Fixed - nosniff, X-Frame-Options DENY, Referrer-Policy, HSTS, Permissions-Policy via next.config; poweredByHeader off. |
| M8 | Currency change on the float account silently relabels all historical amounts (no conversion). | Mitigated - explicit confirmation dialog spelling out the consequence. Real fix (FX-aware model) is Phase-2 architecture. |

### Low

| # | Finding | Status |
|---|---|---|
| L1 | `fl-accounts.zip` (full source snapshot) tracked in git; HEAD commit consisted solely of it. Verified to contain no secrets (.env.local not inside). | Fixed - removed from the tree (history untouched; nothing sensitive to purge). |
| L2 | No tests at all; forecast/payroll correctness asserted only in comments. | Fixed - vitest suite covering forecast maths, payroll (Rigo worked example), and formatters; `npm test` wired up. |
| L3 | No ESLint config (`next lint` was unconfigured). | Fixed - `next/core-web-vitals` config added; lint clean. |
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
