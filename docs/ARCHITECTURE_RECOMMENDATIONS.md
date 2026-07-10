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
                        DELIVERED 2026-07-11 (authored, not yet applied -
                        20260711220000_fin_entities.sql): richer than this
                        sketch (code join key, country/timezone/FY start,
                        payroll calendar default, registration/tax id,
                        archive lifecycle). See ENTITY_MODEL.md.

fin_bank_accounts       Real-world cash locations, per entity.
                        (id, entity_id, name, currency, is_float, active)
                        v1 float_accounts rows map 1:1 onto these.
                        DELIVERED 2026-07-11 (authored, not yet applied -
                        20260711230000_fin_bank_accounts.sql): registry only,
                        not yet wired as float_accounts' successor -
                        float_accounts still holds the baseline/forecast
                        inputs the app reads; fin_bank_accounts is a parallel
                        registry (balances, primary flag, masking) that bills
                        can now point at via bank_account_id. Unifying the
                        two is still Phase 3. See BANK_ACCOUNT_MODEL.md.

fin_accounts            Chart of accounts (financial accounts, not bank
                        accounts): cash, AP, AR, salary expense, SSF payable,
                        TDS payable, intercompany receivable/payable, equity,
                        revenue categories, expense categories.
                        (id, entity_id, code, name, type
                         [asset|liability|equity|income|expense], active)
                        DELIVERED 2026-07-11 (authored, not yet applied -
                        20260711240000_fin_ledger.sql): richer than this
                        sketch (8 types incl. cost_of_sales/other_income/
                        other_expense, free-choice normal_balance for contra
                        accounts, same-entity parent via composite FK + cycle
                        guard, postable vs header, per-account currency
                        override, archive lifecycle, frozen entity/type/
                        normal_balance once referenced). A starter chart is
                        seeded for the two entities that existed at authoring
                        time only - no auto-seed hook for later entities. See
                        CHART_OF_ACCOUNTS.md.

fin_journals            Posted, immutable journal headers.
                        (id, entity_id, journal_date, description,
                         source_type [bill|payroll_run|revenue|transfer|
                         deposit|rebaseline|manual], source_id, posted_by,
                         posted_at, reverses_journal_id NULL)
fin_journal_lines       Balanced lines; SUM(debit-credit) per journal = 0,
                        enforced by a deferred constraint trigger.
                        (id, journal_id, account_id, bank_account_id NULL,
                         debit, credit, currency, fx_rate NULL, memo)
                        DELIVERED 2026-07-11 (authored, not yet applied -
                        20260711240000_fin_ledger.sql): both tables match
                        this sketch closely - status is draft/posted only
                        (no stored 'reversed' status; it is derived from
                        another journal's reverses_journal_id), journal_no
                        is assigned gapless per-entity only at POST time
                        (advisory-lock + max()+1, never client-supplied),
                        the balance check is a DEFERRABLE INITIALLY DEFERRED
                        constraint trigger exactly as sketched, and
                        source_type's vocabulary is reserved but only
                        manual/reversal are produced this milestone -
                        nothing posts bills/payroll_run/revenue/transfer/
                        deposit/rebaseline journals yet. posted_by_name is
                        also stored (denormalised, since the posting RPC has
                        no session to join against - see POSTING_ENGINE.md).
                        See LEDGER_ARCHITECTURE.md and POSTING_ENGINE.md.

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
                         DELIVERED 2026-07-11 in workflow form (authored, not
                         yet applied - 20260711230000_fin_bank_accounts.sql):
                         status machine (planned/in_transit/settled/
                         cancelled), settled-immutable, derived
                         from/to_entity_id, is_intercompany flag. Still
                         missing from this sketch: fx_rate and
                         posted_journal_id - no journals post yet (Phase 3),
                         and rows are single-currency (no FX conversion).
                         See BANK_ACCOUNT_MODEL.md.

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

**DELIVERED 2026-07-11 at foundation level for rules 1, 2, 4, 5 (authored,
not yet applied); rule 3 explicitly NOT built; rule 6 delivered with one
deviation.** See annotations below and LEDGER_ARCHITECTURE.md /
POSTING_ENGINE.md for the full detail.

1. Journals balance: deferred trigger rejects unbalanced journals.
   **Delivered**, and further layered than this one-line rule implies: an
   RLS policy shape that only ever allows draft rows to be client-written, a
   guard trigger that blocks the draft-to-posted transition outside the
   posting RPCs, RPC-level validation before posting, *and* the deferred
   commit-time trigger this rule names - four independent layers, not one.
   See LEDGER_ARCHITECTURE.md's "four enforcement layers".
2. Journals are immutable: no UPDATE/DELETE policies at all; corrections are
   new journals with `reverses_journal_id` set. **Delivered**, via guard
   triggers rather than "no policy at all" - `fin_journals` and
   `fin_journal_lines` do have UPDATE/DELETE RLS policies, but every one of
   them is scoped to `status = 'draft'`, and a `BEFORE` guard trigger
   backstops the same rule for every role including `service_role` (which
   bypasses RLS but not triggers). Reversal is `fin_reverse_journal()`,
   producing a new journal with `reverses_journal_id` set exactly as
   sketched, with `source_type = 'reversal'`.
3. Period locks: `fin_period_locks (entity_id, locked_through date)`;
   posting into a locked period is rejected by trigger. **Not built.** No
   `fin_period_locks` table exists; `fin_post_journal()`/
   `fin_reverse_journal()` do not check `journal_date` against anything.
   There is no closing process yet to protect, since no document module
   posts to the ledger. See TECH_DEBT.md D18.
4. Money columns are `numeric(14,2)` with CHECK >= 0 where signs are fixed by
   the model (debit/credit columns, document amounts). **Delivered** as
   specified (`debit`/`credit` are `numeric(14,2) CHECK (>= 0)`, plus a
   single-sidedness CHECK that also rejects zero-amount lines).
5. Posting is a Postgres RPC (`fin_post_bill`, `fin_post_payroll_run`, ...)
   run as SECURITY DEFINER after role checks - one transaction covering
   document status change + journal + lines. The browser never assembles a
   journal. This is where operation order / durable success point / rollback
   live for every multi-step financial operation. **Delivered at the
   generic-engine level, not yet the per-document level**: `fin_post_journal()`
   / `fin_reverse_journal()` exist, are `SECURITY DEFINER`, and are
   `service_role`-only after the calling route's own role check - but there
   is no `fin_post_bill()`/`fin_post_payroll_run()` yet, because no document
   module posts through the ledger yet (this milestone ships only manual
   journal entry). A future document RPC would create its own draft + lines
   and then call `fin_post_journal()` - see POSTING_ENGINE.md's "What a
   future module must do to post".
6. RLS: same `is_accounts_app_user()` boundary for reads; writes only via the
   RPCs (revoke direct INSERT on ledger tables from authenticated).
   **Delivered for reads and for the posted-status transition specifically,
   with one deliberate deviation from this rule's literal wording**: reads
   use the same `is_accounts_app_user()` boundary as sketched, and the
   `posted` transition genuinely is RPC-only (`authenticated` has no
   EXECUTE grant on either posting RPC at all). But direct `INSERT`/`UPDATE`/
   `DELETE` on `fin_journals`/`fin_journal_lines` **is** granted to
   `authenticated` - scoped by RLS to `status = 'draft'` rows only. This is
   intentional, not an oversight: a draft is explicitly not a financial
   record (see LEDGER_ARCHITECTURE.md's design principle), so gating draft
   CRUD through an RPC would add ceremony without adding integrity - the
   posting RPC is where the real gate lives.

## Migration path (additive, no big-bang)

1. **Delivered 2026-07-11, in fuller form than this sketch (authored, not
   yet applied)**: `fin_entities` + `fin_bank_accounts` (+ `fin_transfers`
   workflow), Nepal backfilled from float_accounts, `entity_id` added to
   every existing financial table - NOT NULL rather than nullable, backed by
   a derive-trigger instead of app-side backfill logic, so an
   already-deployed app version keeps working unmodified. App keeps reading
   `float_accounts` directly (not yet a compatibility view - that unification
   is still open, see the `fin_bank_accounts` note above). See
   ENTITY_MODEL.md and BANK_ACCOUNT_MODEL.md.
2. **Superseded by the split-ownership decision (Kenneth, 2026-07-11).**
   `payroll_runs`/`payroll_run_lines` are not built in fl-accounts: fl-people
   owns runs and payslip history (`hr_payroll_runs`/`hr_payroll_items`), and
   fl-accounts mirrors finalised totals via `payroll_run_snapshots`
   (append-only, done 2026-07-11 - see ROADMAP.md and
   FINANCIAL_SYSTEM_REVIEW.md). This already feeds the forecast
   (`lib/payrollForecast.js`) without an fl-accounts payroll run table. The
   future `fin_` ledger (steps 3+ below) will consume `payroll_run_snapshots`
   to post payroll journals rather than reading from an fl-accounts-owned
   `payroll_runs` table.
3. **Delivered 2026-07-11 at foundation level (authored, not yet applied -
   20260711240000_fin_ledger.sql)**: chart of accounts + journals + the
   generic posting/reversal RPCs, per the annotated schema sketch and "Rules
   the schema must enforce" above. Deviations from this step as originally
   scoped: no `fin_period_locks` (see rule 3 above, TECH_DEBT.md D18); the
   posting RPCs are `service_role`-only with an explicit re-verified actor
   parameter rather than callable by `authenticated` at all (see
   POSTING_ENGINE.md's "Why p_actor_id is explicit"); and, most
   significantly, **document posting is not wired yet** - "start posting NEW
   bills and payroll runs; backfill historical paid bills as opening
   journals" remains entirely open. This milestone ships the engine and a
   manual-journal UI only; no bill, payroll run, or historical backfill
   generates a journal. See LEDGER_ARCHITECTURE.md, CHART_OF_ACCOUNTS.md and
   POSTING_ENGINE.md.
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
