# Roadmap - fl-accounts

fl-accounts is Funding Loop's internal finance platform in the making. v1
(shipped) is the Nepal float/bills/payroll tracker; the destination is the
multi-entity finance system described in
[ARCHITECTURE_RECOMMENDATIONS.md](ARCHITECTURE_RECOMMENDATIONS.md).

## Now (done - July 2026 remediation)

- Security hardening: accounts-role RLS fix (migration, pending apply), MFA
  (TOTP), security headers, upload/download hardening, honest failure
  handling, audit journal + DB constraints (migration, pending apply).
- Test foundation: vitest suite over forecast/payroll/format maths.
- Documentation set (this docs/ tree) established.

## Next (Phase 2 - first platform increments)

1. **Apply the two pending migrations** (`team_members_self_read`,
   `fl_accounts_integrity`) via fl-crm's `supabase db push`, run their
   post-apply verification, and confirm the accounts user can sign in.
2. **Payroll runs**: `payroll_runs` + `payroll_run_lines`, a "close period"
   action, payslip history, SSF/TDS liability accrual, payroll line in the
   cashflow forecast. (Step 2 of the migration path; highest value.)
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
