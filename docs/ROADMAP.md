# Roadmap - fl-accounts

fl-accounts is Funding Loop's internal finance platform in the making. v1
(shipped) is the Nepal float/bills/payroll tracker; the destination is the
multi-entity finance system described in
[ARCHITECTURE_RECOMMENDATIONS.md](ARCHITECTURE_RECOMMENDATIONS.md).

## Now (done - July 2026 remediation)

- Security hardening: accounts-role RLS fix, MFA (TOTP), security headers,
  upload/download hardening, honest failure handling, audit journal + DB
  constraints. Both migrations (`20260711120000_team_members_self_read`,
  `20260711130000_fl_accounts_integrity`) were applied to the production
  Supabase project on 2026-07-11 - the milestone is closed.
- Test foundation: vitest suite over forecast/payroll/format maths.
- CI: GitHub Actions workflow (`.github/workflows/ci.yml`) running npm ci,
  test, lint and build on every push and pull request - added in commit
  288a9f0, first run confirmed green.
- Baseline release tagged `accounts-platform-v1`.
- Documentation set (this docs/ tree) established.
- **Payroll split-ownership decision** (Kenneth, 2026-07-11): fl-people owns
  the Nepal payroll system-of-record (`hr_payroll_runs` / `hr_payroll_items`,
  its TDS slab engine, payslip PDFs, employee self-service); fl-accounts
  stores only a finance-side snapshot of each finalised run. Shipped:
  `payroll_run_snapshots` append-only mirror + `accounts_sync_payroll_snapshots()`
  / `accounts_finalised_payroll_runs()` SECURITY DEFINER RPCs (migration
  `20260711160000_payroll_run_snapshots.sql`, requires
  `20260711150000_hr_payroll_foundation.sql` first - both authored in the
  fl-crm ledger, **not yet applied**), the "Payroll run history" section on
  `/payroll` (sync + table + CSV), and finalised payroll feeding the
  cashflow forecast (SSF/TDS remittances + net wages, `lib/payrollForecast.js`).
  66 tests passing. See FINANCIAL_SYSTEM_REVIEW.md and SECURITY.md for the
  reassessed capability rows and security boundary.

## Next (Phase 2 - first platform increments)

1. **Live verification** of the applied milestone at
   accounts.fundingloop.au: accounts-role sign-in, MFA enrolment, attachment
   round-trip, audit rows landing (see SECURITY.md post-apply checks). Now
   also covers applying `20260711150000_hr_payroll_foundation.sql` then
   `20260711160000_payroll_run_snapshots.sql` and running each migration's
   post-apply verification, then confirming live at accounts.fundingloop.au:
   the payroll history section syncs and the dashboard note flips to
   "Includes payroll from finalised runs...".
2. **Payroll runs** - superseded by the split-ownership decision above.
   fl-accounts does not build its own `payroll_runs` / `payroll_run_lines`;
   fl-people owns runs, fl-accounts mirrors finalised totals via
   `payroll_run_snapshots` (done 2026-07-11, pending migration apply).
   Remaining follow-on: once the two migrations are applied and
   live-verified, revisit whether the forecast's AD-calendar remit-date
   approximation (TECH_DEBT D11) needs tightening.
3. **Entities and bank accounts**: `fin_entities` + `fin_bank_accounts`,
   account switcher in the UI, Nepal backfill. Unblocks the AU entity.
4. **MFA policy decision**: whether enrollment becomes mandatory per role.

## Later (Phase 3+)

- Chart of accounts + journals + posting RPCs (the ledger spine); re-baseline
  becomes an adjustment journal.
- Revenue: settled-revenue table + CRM push (service-role webhook with
  idempotency on crm_deal_id).
- Budgets and forecast snapshots (actual vs forecast reporting).
- Intercompany transfers; AUD consolidation / FX rates.
- Per-entity authorisation (membership table consumed by RLS).
- Next.js major upgrade (TECH_DEBT D1); evaluate dedicated Supabase project
  for finance isolation.

## Explicit non-goals for now

- No bank feeds ("this is a forecast, not a bank feed" - v1 brief).
- No per-bill currency before FX rates and a reporting-currency decision.
- No shared @fl/ui package.
