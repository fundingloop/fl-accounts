# Technical Debt - fl-accounts

Known, accepted debt with the reason it is accepted and the trigger that
should un-accept it. Security findings and their statuses live in
[SECURITY.md](SECURITY.md); target architecture in
[ARCHITECTURE_RECOMMENDATIONS.md](ARCHITECTURE_RECOMMENDATIONS.md).

| # | Debt | Why accepted | Revisit when |
|---|---|---|---|
| D1 | Next.js 14.2.35 with published advisories (image-optimizer DoS mitigated by `images.unoptimized`; remaining items do not match this app's usage - no Pages Router i18n, no WebSocket upgrades, no cached RSC surface worth poisoning). No non-breaking fix exists inside 14.x. | Upgrade to Next 15/16 pulls a React major and framework behaviour changes - too risky to bundle into a security remediation. | Next maintenance window; before any new feature work builds on framework behaviour. |
| D2 | Browser-direct financial writes under coarse RLS (any accounts-app role can modify any row, including the float baseline). CHECK constraints + audit journal backstop it. | v1 is a 3-role internal float tracker; moving every write behind routes/RPCs now would rewrite the app. | First step of the ledger migration (ARCHITECTURE_RECOMMENDATIONS "Rules 5/6"). |
| D3 | Recurring bills have one `paid` flag (no per-occurrence payment history); re-marking unpaid resurrects a past occurrence. | Matches the locked v1 brief ("no per-occurrence payments table yet"); forecast handles the anchor-step correctly. | When month-by-month historical actuals are needed - `fin_bill_occurrences` in the target schema. |
| D4 | Payroll never feeds the cashflow forecast (largest recurring outflow missing from the projection). | Deliberately out of v1 scope; needs payroll_runs to do properly rather than a hack. | `payroll_runs` (step 2 of the migration path). |
| D5 | MFA is enforced only for users who have enrolled a factor; enrollment itself is voluntary. | Forcing enrollment at next login is an ops/people decision, not a code default; premature forcing risks locking out the Nepal team. | Kenneth decides the policy; then add an `mfa_required` flag (team_members or app metadata) checked by middleware. |
| D6 | No rate limiting on the app's own API routes. | Routes are authenticated + role-gated; serverless in-memory limiters are ineffective; Supabase rate-limits the auth endpoints. | If public/unauthenticated routes are ever added, or upload abuse is observed (use portal_rate_limits-style DB limiter from the CRM). |
| D7 | Deposits/bills hard-delete remains (with audit-journal snapshots as the recovery path). Payroll is soft-delete. | Deleting a mistyped deposit is a legitimate daily operation for the float clerk; the audit journal preserves the record. | Ledger migration makes deletion of posted documents impossible by construction. |
| D8 | Favicon served from fundingloop.com.au (external fetch on every cold load). | Cosmetic; the asset is not in this repo. | Next branding touch-up - copy the file into /app as icon.png. |
| D9 | `float_accounts` conflates entity / bank account / baseline; UI hardwired to the single oldest account. | Locked v1 scope; account_id threading keeps data multi-account-ready. | AU entity onboarding (fin_entities / fin_bank_accounts). |
| D10 | Build brief comment drift: applied migration `20260707100000_payroll.sql` says SSF base is "basic+DA"; code (correctly, per Rigo) uses basic only. Applied migrations are immutable. | History-only inaccuracy; later migration comments and docs are correct. | Never (recorded here). |
