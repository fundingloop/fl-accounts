# Target Architecture Recommendations - fl-accounts (2026-07-11)

Status: RECOMMENDATION ONLY. Nothing in this document is implemented. It is
the Phase-4 deliverable of the July 2026 review: how the schema should evolve
for fl-accounts to become Funding Loop's internal finance platform (multiple
entities, payroll, expenses, revenue, budgets, forecasting, intercompany,
reporting). The current-state assessment that motivates this is in
[FINANCIAL_SYSTEM_REVIEW.md](FINANCIAL_SYSTEM_REVIEW.md).

Constraints honoured throughout:

- Shares the existing Funding Loop Supabase project; all schema changes ship
  as file-first migrations in fl-crm's ledger and are applied manually.
- Evolution must be additive - the running v1 app (float, bills, payroll
  register) keeps working during the transition; v1 tables are migrated into
  the new model, not dropped.
- The `accounts` role security boundary (is_accounts_app_user, and the
  is_team_member/is_staff exclusions) is preserved as-is.

## Design principle

One double-entry ledger is the spine; everything else (bills, payroll,
revenue, transfers) is a *document* that posts balanced journal entries to it.
Documents are mutable until posted; the ledger is append-only (corrections are
reversing entries, never edits). Balances are ledger sums, not client-side
arithmetic over raw documents.

## Target schema (namespaced `fin_`)

```
fin_entities            Legal entities: Funding Loop Pty Ltd (AU),
                        Nepal operations, future.
                        (id, name, country, functional_currency, active)

fin_bank_accounts       Real-world cash locations, per entity.
                        (id, entity_id, name, currency, is_float, active)
                        v1 float_accounts rows map 1:1 onto these.

fin_accounts            Chart of accounts (financial accounts, not bank
                        accounts): cash, AP, AR, salary expense, SSF payable,
                        TDS payable, intercompany receivable/payable, equity,
                        revenue categories, expense categories.
                        (id, entity_id, code, name, type
                         [asset|liability|equity|income|expense], active)

fin_journals            Posted, immutable journal headers.
                        (id, entity_id, journal_date, description,
                         source_type [bill|payroll_run|revenue|transfer|
                         deposit|rebaseline|manual], source_id, posted_by,
                         posted_at, reverses_journal_id NULL)
fin_journal_lines       Balanced lines; SUM(debit-credit) per journal = 0,
                        enforced by a deferred constraint trigger.
                        (id, journal_id, account_id, bank_account_id NULL,
                         debit, credit, currency, fx_rate NULL, memo)

fin_transactions        Optional convenience view over journal lines filtered
                        to cash accounts = the bank-account statement view.

fin_documents           -- one table per document type, all posting to the ledger:
  bills                 (keep; add entity_id, bank_account_id, currency,
                         posted_journal_id; recurring split out - see below)
  fin_recurring_templates  Recurrence definitions for bills / expenses /
                         revenue / payroll (replaces bills.charge_type):
                        (id, entity_id, kind, template jsonb, recurrence,
                         next_run_date, active)
  fin_bill_occurrences  One row per generated occurrence with its own status
                        and payment link (fixes the single-paid-flag model).
  fin_revenue           Settled revenue (CRM push lands here first).
                        (id, entity_id, source [crm|manual], crm_deal_id NULL,
                         description, amount, currency, received_date,
                         bank_account_id, posted_journal_id)
  payroll_runs          Period snapshot: (id, entity_id, period_start,
                         period_end, status [draft|approved|posted],
                         approved_by, posted_journal_id)
  payroll_run_lines     Frozen payslip per employee per run - every figure
                        lib/payroll.js computes today, persisted.
  fin_transfers         Intercompany / inter-account moves: (id, from_bank
                         _account_id, to_bank_account_id, amounts, fx_rate,
                         status, posted_journal_id) - posts intercompany
                         receivable/payable lines when entities differ.

fin_budgets             (id, entity_id, name, period [month], account_id,
                         amount, currency) - budget vs ledger actuals is then
                         a single grouped query.
fin_forecast_snapshots  Persisted forecast runs (inputs hash + series jsonb)
                        so actual-vs-forecast becomes queryable history.

fin_attachments         Generalises bills.attachment_path: (id, entity_id,
                         parent_type, parent_id, storage_path, uploaded_by,
                         created_at). One private bucket per concern, paths
                         validated server-side exactly as today.

fl_accounts_audit_log   Already live (July 2026): row-level audit journal on
                        the v1 tables; extend the trigger to every fin_ table.
```

## Rules the schema must enforce (not the client)

1. Journals balance: deferred trigger rejects unbalanced journals.
2. Journals are immutable: no UPDATE/DELETE policies at all; corrections are
   new journals with `reverses_journal_id` set.
3. Period locks: `fin_period_locks (entity_id, locked_through date)`;
   posting into a locked period is rejected by trigger.
4. Money columns are `numeric(14,2)` with CHECK >= 0 where signs are fixed by
   the model (debit/credit columns, document amounts).
5. Posting is a Postgres RPC (`fin_post_bill`, `fin_post_payroll_run`, ...)
   run as SECURITY DEFINER after role checks - one transaction covering
   document status change + journal + lines. The browser never assembles a
   journal. This is where operation order / durable success point / rollback
   live for every multi-step financial operation.
6. RLS: same `is_accounts_app_user()` boundary for reads; writes only via the
   RPCs (revoke direct INSERT on ledger tables from authenticated).

## Migration path (additive, no big-bang)

1. `fin_entities` + `fin_bank_accounts`; backfill Nepal from float_accounts;
   add nullable `entity_id` to existing tables. App keeps reading
   float_accounts (now a compatibility view or a synced row).
2. `payroll_runs`/`payroll_run_lines` + a "close pay period" action in the
   payroll tab (first real consumer; immediately fixes payroll history and
   feeds the forecast).
3. Chart of accounts + journals + posting RPCs; start posting NEW bills and
   payroll runs; backfill historical paid bills as opening journals.
4. Revenue table + CRM push (webhook/service-role route with idempotency key
   = crm_deal_id, so retries cannot double-post revenue).
5. Budgets, forecast snapshots, transfers, AU entity onboarding.
6. Retire client-side balance math: hero balance = cash-account ledger sum;
   re-baseline becomes a posted adjustment journal instead of overwriting
   starting_float (removing the last mutable-history write).

## Non-schema recommendations

- Split app-level roles further before the AU entity arrives (Nepal accounts
  clerk should not see AU payroll): per-entity membership table consumed by
  RLS, not new role_type values.
- Consider a dedicated Supabase project for finance once the CRM push exists
  (blast-radius isolation); the shared project is acceptable while the CRM
  is the only integration and both apps are internal-staff-only.
- Keep Next.js on the latest supported major (currently pinned mitigations
  are in place; see TECH_DEBT.md).
