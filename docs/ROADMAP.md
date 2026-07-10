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
  fl-crm ledger and **applied to the production Supabase project 2026-07-11**,
  in that order, with each migration's post-apply verification block passing),
  the "Payroll run history" section on `/payroll` (sync + table + CSV), and
  finalised payroll feeding the cashflow forecast (SSF/TDS remittances + net
  wages, `lib/payrollForecast.js`). 66 tests passing. The milestone is closed
  at the schema/app level; live end-to-end verification at
  accounts.fundingloop.au is still outstanding (see "Next" below). See
  FINANCIAL_SYSTEM_REVIEW.md and SECURITY.md for the reassessed capability
  rows and security boundary.
- **Entities and bank accounts** (commits `bc369fa`, `4757972`, `2094004`,
  2026-07-11): done at the schema/app level. `fin_entities` (legal entity
  registry, Funding Loop Pty Ltd/AU + Funding Loop Nepal/NP seeded),
  `fin_bank_accounts` (per-entity bank account registry) and `fin_transfers`
  (transfer workflow incl. intercompany) authored as
  `20260711220000_fin_entities.sql` then
  `20260711230000_fin_bank_accounts.sql` (fl-crm ledger, apply order
  matters), with an `entity_id` retrofit onto every existing financial
  table. New pages `/entities`, `/banking`, `/transfers`; a persistent
  entity switcher (Current / All entities) in `AppShell`; the dashboard,
  bills, float and payroll pages are all entity-aware (single-entity view or
  an all-entities group view); `forecastSummary()` and `snapshotsForEntity()`
  added with unit tests. **Both migrations are committed to the fl-crm
  ledger but NOT YET APPLIED to the production Supabase project** - the app
  runs its pre-migration fallback (a single virtual Nepal entity; amber
  "migration not applied yet" banners on `/entities`, `/banking`,
  `/transfers`) until they are. See ENTITY_MODEL.md and
  BANK_ACCOUNT_MODEL.md for the full design; "Next" below for the apply
  plan.
- **General ledger foundation** (commit b31b911, fl-crm 622fb1e,
  2026-07-11): done at the schema/app level. `fin_accounts` (per-entity
  chart of accounts, 8 types, archive-only), `fin_journals` /
  `fin_journal_lines` (double-entry journal headers/lines - draft rows
  RLS-editable, posted rows immutable for every role) and two
  `service_role`-only posting RPCs, `fin_post_journal()` /
  `fin_reverse_journal()`, authored as `20260711240000_fin_ledger.sql`
  (fl-crm ledger, requires `20260711220000_fin_entities.sql` and
  `20260711230000_fin_bank_accounts.sql` applied first). New `/ledger`
  module (Journal Entries list, manual journal entry/edit, journal detail
  with post/reverse/delete, Chart of Accounts) added to `AppShell` between
  Transfers and Entities; `lib/ledger.js` + `lib/ledgerPostingErrors.js`
  with unit tests. **The migration is committed to the fl-crm ledger but NOT
  YET APPLIED to the production Supabase project** - `/ledger` and
  `/ledger/accounts` show the same amber "migration not applied yet" banner
  pattern until it is. See LEDGER_ARCHITECTURE.md, CHART_OF_ACCOUNTS.md and
  POSTING_ENGINE.md for the full design; "Next" below for the apply plan.

## Next (Phase 2 - first platform increments)

1. **Live verification** of the applied milestone at
   accounts.fundingloop.au: accounts-role sign-in, MFA enrolment, attachment
   round-trip, audit rows landing (see SECURITY.md post-apply checks). Both
   payroll snapshot migrations (`20260711150000_hr_payroll_foundation.sql`
   then `20260711160000_payroll_run_snapshots.sql`) are applied and their
   post-apply verification blocks passed; what remains is the live UI
   verification at accounts.fundingloop.au: the payroll history section
   syncs idempotently (finalise a supervised run in fl-people, first sync
   captures 1, second sync captures 0, totals match, no employee-level data
   visible), the dashboard note flips to "Includes payroll from finalised
   runs...", non-accounts users are rejected by both RPCs, UPDATE/DELETE on
   `payroll_run_snapshots` are rejected, and the capture lands in
   `fl_accounts_audit_log`.
2. **Payroll runs** - superseded by the split-ownership decision above.
   fl-accounts does not build its own `payroll_runs` / `payroll_run_lines`;
   fl-people owns runs, fl-accounts mirrors finalised totals via
   `payroll_run_snapshots` (done and applied 2026-07-11). Remaining
   follow-on: once live verification (item 1 above) is complete, revisit
   whether the forecast's AD-calendar remit-date approximation
   (TECH_DEBT D11) needs tightening.
3. **Apply the entity + bank account migrations**: schema/app work is done
   (see "Now" above) but `20260711220000_fin_entities.sql` and
   `20260711230000_fin_bank_accounts.sql` are not yet applied to the
   production Supabase project. Apply in that order (`supabase db push`) and
   run each migration's own pre-apply / post-apply blocks:
   - Pre-apply (fin_entities): confirm `fin_entities` does not exist yet,
     `float_accounts`/`payroll_run_snapshots` do, the three shared RLS
     helper functions exist, every existing `payroll_run_snapshots.entity_code`
     is one of `fl-nepal`/`fl-au` (0 rows otherwise), and there are no
     orphaned `bills`/`float_deposits` referencing a missing float account.
   - Post-apply (fin_entities): `fin_entities` has exactly the two seeded
     rows (`fl-au`, `fl-nepal`, both active); `entity_id` is NOT NULL and
     fully backfilled on all five retrofitted tables (0 NULLs each); the
     `payroll_run_snapshots` append-only guard is re-enabled
     (`tgenabled = 'O'`); as an accounts-app user, inserting a bill without
     `entity_id` inherits the float account's entity, inserting one with a
     contradicting `entity_id` is rejected, deleting an entity is rejected,
     renaming an entity's `code` is rejected; as a non-accounts user,
     `fin_entities` returns 0 rows.
   - Pre-apply (fin_bank_accounts): confirm `fin_entities` now exists and
     `fin_bank_accounts`/`fin_transfers` do not yet; confirm `bills` has
     neither `bank_account_id` nor `vendor` yet.
   - Post-apply (fin_bank_accounts): `fin_bank_accounts`/`fin_transfers`
     exist with their expected triggers; as an accounts-app user, a second
     `is_primary=true` bank account for the same entity is rejected
     (unique violation), deleting a bank account is rejected, moving one to
     another entity is rejected, a transfer's `is_intercompany` and derived
     entity ids are correct, settling a transfer then updating it again is
     rejected, deleting a settled transfer is rejected, pointing a bill's
     `bank_account_id` at another entity's account is rejected; as a
     non-accounts user, both new tables return 0 rows.
   See ENTITY_MODEL.md and BANK_ACCOUNT_MODEL.md for the full column/trigger
   reference behind each check.
4. **Apply the general ledger foundation migration**: schema/app work is
   done (see "Now" above) but `20260711240000_fin_ledger.sql` is not yet
   applied to the production Supabase project. It requires
   `20260711220000_fin_entities.sql` and `20260711230000_fin_bank_accounts.sql`
   (item 3 above) applied first. Apply it and run its own pre-apply /
   post-apply blocks (see the migration file's header comment for the exact
   SQL):
   - Pre-apply: confirm `fin_entities`/`fin_bank_accounts` exist,
     `fin_accounts`/`fin_journals`/`fin_journal_lines` do not exist yet, the
     three shared RLS helper functions exist, and both seeded entities
     (`fl-au`, `fl-nepal`) are present.
   - Post-apply: the three new tables and their triggers exist; the seeded
     chart counts are exactly 14 (`fl-au`) and 16 (`fl-nepal`); as an
     accounts-app user, a draft journal + balanced lines inserts fine,
     flipping a journal's `status` to `posted` directly is blocked by RLS,
     deleting or updating a posted journal fails (guard), a line on another
     entity's account fails, a both-sided line fails (CHECK); as
     `service_role`, inserting a journal directly with `status = 'posted'`
     fails (guard); via the `service_role` RPCs, `fin_post_journal()` on a
     balanced draft returns journal number 1 and posting the same journal
     again fails, posting an imbalanced draft fails, `fin_reverse_journal()`
     on a posted journal returns a new posted journal with swapped lines and
     reversing the same journal again fails; as a non-accounts user, all
     three tables return 0 rows; as `authenticated` (even an accounts-role
     user), calling either RPC directly fails (no EXECUTE grant). See
     LEDGER_ARCHITECTURE.md, CHART_OF_ACCOUNTS.md and POSTING_ENGINE.md for
     the full reference behind each check.
5. **Live verification** of the entities/banking milestone at
   accounts.fundingloop.au once applied: the switcher lists both seeded
   entities plus "All entities" and persists the selection across a reload;
   `/entities`, `/banking`, `/transfers` each drop their amber "not applied
   yet" banner and load real data; the dashboard/bills/float/payroll pages
   correctly scope to the selected entity; the group dashboard's totals stay
   split per currency (never summed across AUD/NPR).
6. **Live verification** of the ledger foundation at accounts.fundingloop.au
   once applied: `/ledger` and `/ledger/accounts` drop their amber banner and
   load real data; a manual journal can be created, saved as a draft, edited,
   posted (`Save & post` or Post), and reversed end to end; a failed post
   leaves the draft intact with the error shown honestly.
7. **MFA policy decision**: whether enrollment becomes mandatory per role.

## Later (Phase 3+)

- Chart of accounts + journals + posting RPCs (the ledger spine). **Delivered
  at foundation level, 2026-07-11** (authored, not applied - see "Now" and
  "Next" above): `fin_accounts`/`fin_journals`/`fin_journal_lines` and the
  two posting RPCs exist and are unit-tested; nothing posts to them yet.
  Still open: document posting (bills, payroll, revenue all becoming journal
  sources) and re-baseline becoming an adjustment journal instead of
  overwriting `float_accounts.starting_float` - see
  LEDGER_ARCHITECTURE.md's "What future modules will do".
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
