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
| Multiple legal entities | Not supported | No entity concept at all. `float_accounts.name` is the closest thing. Adding rows "works" but every page hardcodes the first account (`useFloatAccount` takes the oldest row). |
| Multiple bank accounts | Partial (schema), No (app) | `account_id` is threaded through every table (good foresight), but the UI resolves exactly one account and has no switcher. |
| Multiple currencies | Not safe | One currency label per account; changing it relabels history with no conversion (UI now warns). No FX rates, no per-transaction currency, no reporting currency. |
| Payroll history / periods | Not supported | Register is current-state only. Editing a salary silently rewrites the past (the new audit journal preserves forensics, but there is no *payroll run* record, no payslip persistence, no period lock). |
| Recurring payroll | Not supported | Payroll never feeds the cashflow forecast or bills - the forecast omits the company's largest recurring outflow. |
| Recurring expenses | Partial | Recurring bills project occurrences client-side, but with a single `paid` flag there is no per-occurrence payment history; marking the anchor paid just advances the projection. |
| Recurring revenue | Not supported | No revenue tables. Deposits are untyped inflows. |
| Budgets / actual-vs-forecast | Not supported | No budget tables; forecasts are ephemeral (recomputed per page view, never persisted), so there is nothing to compare actuals against. |
| Tax obligations / liabilities | Not supported | SSF/TDS/SST are computed for display but never accrued as liabilities with due dates; they do not appear in cashflow. |
| Intercompany transfers | Not supported | Single-entity model; a transfer would be a deposit with a note. |
| Audit history | Now partial | Added 2026-07: `fl_accounts_audit_log` (append-only, trigger-fed, admin-read) captures every insert/update/delete on the four tables. |
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
5. **Entity/account/currency conflation** (see table above) blocks the AU
   entity, intercompany and consolidation outright.

## Recommendations (ranked)

1. Adopt the ledger-centric target schema in
   [ARCHITECTURE_RECOMMENDATIONS.md](ARCHITECTURE_RECOMMENDATIONS.md) before
   building revenue, budgets, or the AU entity onto v1 tables. Additive
   migration path, no rewrite of the running app.
2. Introduce `payroll_runs` (+ `payroll_run_lines`) as the first evolution:
   snapshot each period's computed payslips, accrue SSF/TDS liabilities, and
   feed the forecast. Highest value-to-effort in the current app.
3. Move financial writes behind server routes (or Postgres RPCs) so
   validation, audit context and multi-step ordering are enforced server-side.
   The July 2026 remediation started this with bill deletion.
4. Keep the client forecast util (it is pure and now unit-tested) but source
   its inputs from persisted period aggregates once volumes grow.
5. Do not add per-bill currency until there is an FX-rate table and a
   reporting-currency decision (AUD consolidation vs per-entity reporting).
