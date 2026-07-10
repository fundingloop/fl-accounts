# Financial System Review - fl-accounts (2026-07-11)

Scope: reviewing fl-accounts as a *finance system*, not merely a web app.
fl-accounts is intended to grow into Funding Loop's internal finance and
operations platform (AU entity + Nepal operations + future entities; payroll,
expenses, revenue, forecasting, cashflow, budgeting, intercompany, reporting).
This document assesses what the current v1 design can and cannot safely carry,
and where it will not scale. The remediation actually applied in July 2026 is
tracked in [SECURITY.md](SECURITY.md); the target schema lives in
[ARCHITECTURE_RECOMMENDATIONS.md](ARCHITECTURE_RECOMMENDATIONS.md).

## What v1 actually is

A cash-basis float tracker for one Nepal account:

- `float_accounts` - one row ("Nepal", NPR). Conflates *legal entity*, *bank
  account* and *accounting baseline* (starting_float + as-of date) into one
  record.
- `bills` - accounts payable only. One row per bill; recurring bills are a
  single row with a recurrence label and ONE `paid` flag (no per-occurrence
  payments).
- `float_deposits` - undated-category inflows (top-ups). No revenue concept.
- `payroll_employees` - a *current-state* salary register. Derived pay figures
  (SSF, gross, net) are recomputed client-side on every render; nothing is
  ever snapshotted per pay period.
- Balances and the 6-month forecast are computed client-side
  (`lib/forecast.js`) from full-table reads. Nothing derived is persisted.

This is a reasonable, honest v1 for its stated brief ("this is a forecast,
not a bank feed"). It is not a finance platform, and most of the target
capabilities cannot be bolted on without schema evolution.

## Capability assessment

| Capability | Verdict | Why |
|---|---|---|
| Multiple legal entities | Now: operational foundation, no ledger | `fin_entities` registry authored 2026-07-11 (**not yet applied**): AU + Nepal seeded, unlimited more addable via `/entities`, entity switcher (Current / All) drives every page, `entity_id` retrofitted onto every existing financial table. Still no per-entity authorisation (any accounts-app user sees every entity - SECURITY.md) and no consolidation/FX (group dashboard totals stay per-currency, never summed). See ENTITY_MODEL.md. |
| Multiple bank accounts | Now: operational foundation, no ledger | `fin_bank_accounts` registry authored 2026-07-11 (**not yet applied**): per-entity accounts, one-primary-per-entity, masked account numbers, `/banking` CRUD. `current_balance` is finance-maintained (like v1's `starting_float`), not ledger-derived - a "Forecast balance" column exists in the UI but is a placeholder pending Phase 3. See BANK_ACCOUNT_MODEL.md. |
| Multiple currencies | Not safe | One currency label per float account; changing it relabels history with no conversion (UI now warns). `fin_bank_accounts`/`fin_transfers` add a currency field per row, but still no FX rates, no per-transaction conversion, no reporting currency - the group dashboard and transfers form both refuse to convert, only to warn or subtotal per currency. |
| Intercompany transfers | Now: workflow only, no ledger | `fin_transfers` authored 2026-07-11 (**not yet applied**): a planned -> in_transit -> settled/cancelled workflow between bank accounts, `is_intercompany` flag when the two accounts belong to different entities, settled-immutable by trigger. Deliberately posts no accounting journals yet - the workflow rows become journal sources once Phase 3's ledger exists. See BANK_ACCOUNT_MODEL.md. |
| Payroll history / periods | Partial | Under the 2026-07-11 split-ownership decision, fl-people owns payroll runs and per-employee payslip history (`hr_payroll_runs`/`hr_payroll_items`). fl-accounts holds an immutable finance mirror of each finalised run's totals (`payroll_run_snapshots` - period, SSF/TDS, net; applied to production 2026-07-11, live end-to-end verification outstanding); the `payroll_employees` register remains current-state only and is now explicitly a reference/estimate tool, not history. |
| Recurring payroll | Partial | Finalised payroll now projects into the cashflow forecast (`lib/payrollForecast.js`): known SSF/TDS remittances and not-yet-paid net wages from real snapshots, plus estimated future months extrapolated from the latest run. Still absent: an fl-accounts-side payroll run of record (superseded by design, not a gap - see ROADMAP). |
| Recurring expenses | Partial | Recurring bills project occurrences client-side, but with a single `paid` flag there is no per-occurrence payment history; marking the anchor paid just advances the projection. |
| Recurring revenue | Not supported | No revenue tables. Deposits are untyped inflows. |
| Budgets / actual-vs-forecast | Not supported | No budget tables; forecasts are ephemeral (recomputed per page view, never persisted), so there is nothing to compare actuals against. |
| Tax obligations / liabilities | Partial | For finalised runs, SSF payable and TDS now appear in the cashflow forecast with approximate remit dates (day 15/25 of the following month - an AD-calendar convention, not the exact BS-calendar statutory deadline; TECH_DEBT D11). Still not a true liabilities ledger: no due-date table, no accrual entries, SST remains display-only. |
| Audit history | Now partial | Added and applied to production 2026-07-11: `fl_accounts_audit_log` (append-only, trigger-fed, admin-read) captures every insert/update/delete on the four tables. |
| Immutable financial history | Not supported by design | All four tables are mutated in place by any accounts-app user; deletes were hard deletes (payroll is now soft-delete; bills/deposits remain hard-delete with audit snapshots). True immutability needs a ledger design. |
| Cashflow forecasting | v1-adequate | Deterministic, well-factored client util; fine at this volume. Will not scale to multi-account/multi-entity (full-table reads per page, no persistence, no payroll/tax inflows-outflows). |
| Management reporting | Not supported | No period concept, no categories beyond free-text, no persisted aggregates. |

## Where the current architecture will not scale

1. **No double-entry spine.** Balances are derived by re-summing raw rows on
   the client. With one account and hundreds of rows this is fine; with many
   accounts, entities and currencies it becomes both a performance problem
   (every page pulls `select *` of whole tables) and a correctness problem
   (nothing reconciles; a bug or a direct PostgREST write silently changes
   history). A journal/ledger with balanced entries is the standard fix.
2. **The `paid` flag conflates state with history.** "Recurring bill" needs a
   template (definition) + instances (occurrences with their own status and
   payment record). The v1 single-flag model already causes a visible quirk:
   re-marking a recurring bill unpaid resurrects a past occurrence.
3. **Client-computed, client-written financial state.** Browsers write
   financial rows directly under a coarse role-wide RLS policy. There is no
   server-side validation beyond the new CHECK constraints, no period locks,
   and any of the three roles can rewrite the baseline (`starting_float`) at
   will. Acceptable for a three-user float tracker; not for a platform of
   record.
4. **Payroll is display math.** The Rigo-matched computation is good and
   tested, but nothing persists a payroll run, so there is no NPR liability
   trail (SSF payable, TDS payable), no payslip history, and no payroll line
   in the forecast.
5. **Entity/account/currency conflation is now addressed at the operational
   layer, not the ledger layer.** The `fin_entities`/`fin_bank_accounts`/
   `fin_transfers` foundation (authored 2026-07-11, not yet applied - see
   table above) unblocks the AU entity, multiple bank accounts per entity
   and an intercompany transfer *workflow*. It does not unblock
   consolidation or currency conversion - the group dashboard and transfers
   form both refuse to sum or convert across currencies rather than getting
   it silently wrong. Ledger-backed consolidation is still Phase 3.

## Recommendations (ranked)

1. Adopt the ledger-centric target schema in
   [ARCHITECTURE_RECOMMENDATIONS.md](ARCHITECTURE_RECOMMENDATIONS.md) before
   building revenue, budgets, or the AU entity onto v1 tables. Additive
   migration path, no rewrite of the running app.
2. **Done, 2026-07-11, in re-scoped form.** Originally: introduce
   `payroll_runs` (+ `payroll_run_lines`) as the first evolution, snapshot
   each period's computed payslips, accrue SSF/TDS liabilities, and feed the
   forecast. The split-ownership decision re-scoped this: fl-people owns
   `hr_payroll_runs`/`hr_payroll_items` and payslip persistence; fl-accounts
   mirrors finalised totals via `payroll_run_snapshots` and feeds the
   forecast from that mirror (`lib/payrollForecast.js`). Same outcome
   (payroll history exists, SSF/TDS liabilities and payroll reach the
   forecast), no duplicate system of record. The two migrations were applied
   to production 2026-07-11 (post-apply verification passed for both);
   pending: live end-to-end verification at accounts.fundingloop.au (see
   SECURITY.md M9).
3. Move financial writes behind server routes (or Postgres RPCs) so
   validation, audit context and multi-step ordering are enforced server-side.
   The July 2026 remediation started this with bill deletion.
4. Keep the client forecast util (it is pure and now unit-tested) but source
   its inputs from persisted period aggregates once volumes grow.
5. Do not add per-bill currency until there is an FX-rate table and a
   reporting-currency decision (AUD consolidation vs per-entity reporting).
