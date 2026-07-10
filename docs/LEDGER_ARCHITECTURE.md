# Ledger Architecture - fl-accounts

The double-entry ledger spine: `fin_accounts` (chart of accounts),
`fin_journals` (journal headers) and `fin_journal_lines` (journal lines),
plus the two posting RPCs that are the only path onto a posted row. Schema
authored in `fl-crm/supabase/migrations`, migration
`20260711240000_fin_ledger.sql` (requires `20260711220000_fin_entities.sql`
and `20260711230000_fin_bank_accounts.sql` applied first - FKs to
`fin_entities` and `fin_bank_accounts`).

**Status: authored and committed to the fl-crm ledger, NOT yet applied to the
production Supabase project.** Until it is applied, `/ledger` and
`/ledger/accounts` degrade to the same amber "migration not applied yet"
banner pattern as `/banking` / `/entities` (`isMissingSchemaError()` /
`ledgerSchemaMissing()`). Apply order: after
`20260711220000_fin_entities.sql` and `20260711230000_fin_bank_accounts.sql`.
See [ROADMAP.md](ROADMAP.md) for the apply/verify plan. See also
[CHART_OF_ACCOUNTS.md](CHART_OF_ACCOUNTS.md) (the `fin_accounts` table in
full) and [POSTING_ENGINE.md](POSTING_ENGINE.md) (the two RPCs in full) -
this document is the spine overview that ties them together.

## Design principle

One double-entry ledger per the platform target design
([ARCHITECTURE_RECOMMENDATIONS.md](ARCHITECTURE_RECOMMENDATIONS.md)):
documents post balanced journals; **nothing writes posted ledger rows
directly**. A journal balances when `SUM(debit) == SUM(credit)` and the total
is greater than zero; each line is single-sided (`debit > 0 XOR credit > 0`,
both `>= 0`, 2dp). Posted journals and their lines are immutable for every
role, including `service_role` - corrections are always a new reversing
journal, never an edit. Draft journals are the deliberate exception: they are
editable/deletable and are explicitly **not** financial records; they may be
transiently unbalanced, because the posting engine (not the draft-write path)
is the integrity gate.

## The three tables

| Table | What it holds | Full reference |
|---|---|---|
| `fin_accounts` | Per-entity chart of accounts (asset/liability/equity/income/cost_of_sales/expense/other_income/other_expense), postable vs header, archive-only lifecycle. | [CHART_OF_ACCOUNTS.md](CHART_OF_ACCOUNTS.md) |
| `fin_journals` | Journal headers: draft or posted, journal number, source, reversal linkage. | Sections below + [POSTING_ENGINE.md](POSTING_ENGINE.md) |
| `fin_journal_lines` | Debit/credit lines belonging to a journal, tagged to an account and optionally a `fin_bank_accounts` row. | Sections below + [POSTING_ENGINE.md](POSTING_ENGINE.md) |

Every line's `account_id` must belong to the journal's own `entity_id`
(cross-entity lines are structurally rejected - see "Entity isolation"
below). `entity_id` is frozen after insert on both `fin_accounts` and
`fin_journals`.

## Draft-vs-posted lifecycle

`fin_journals.status` is `'draft'` or `'posted'` - **there is no `'reversed'`
status** (see "Derived reversed state" below). A journal is created as a
draft (via ordinary RLS-gated INSERT from the browser), its lines are
inserted/edited/deleted freely while it stays a draft (RLS gates each of
those on the parent journal's `status = 'draft'`), and it becomes `posted`
**only** by calling `fin_post_journal()` - never by a direct `UPDATE`. Once
`status = 'posted'`:

- the guard trigger `fin_journals_guard()` rejects every further `UPDATE`
  unconditionally ("posted journals are immutable"), for every role;
- `fin_journals_guard()` also rejects `DELETE` ("posted journals cannot be
  deleted; corrections are reversing journals");
- `fin_journal_lines_guard()` rejects any INSERT/UPDATE/DELETE on that
  journal's lines ("lines of a posted journal are immutable"), for every
  role, with one carve-out: a line `DELETE` is allowed when its parent
  journal row is already gone (the `ON DELETE CASCADE` path of a permitted
  **draft** header delete - by the time that cascade runs the parent lookup
  finds nothing, which the trigger treats as "not posted, allow it").

A draft can be deleted outright (cascading to its lines); a posted journal
can never be deleted - the only way to net one out is to reverse it.

## Derived "reversed" state

There is no stored "reversed" status. A journal is reversed **if and only
if** some other posted journal's `reverses_journal_id` points at it. The app
computes this with a second query (`fin_journals` rows where
`reverses_journal_id IS NOT NULL`, mapped by the id they reverse) and passes
the result into `journalStatusInfo()` / `nextJournalActions()`
(`lib/ledger.js`) as `{ reversedBy }`. A partial unique index,
`uq_fin_journals_reverses` on `(reverses_journal_id) WHERE
reverses_journal_id IS NOT NULL`, enforces that a journal can be reversed **at
most once** - `fin_reverse_journal()` also checks this explicitly before
inserting, with the index as the race backstop.

`journalStatusInfo()` maps this to a badge: draft -> Draft (amber); posted,
not reversed -> Posted (green); posted and reversed -> Reversed (gray).
`nextJournalActions()` mirrors it for the UI's row actions: draft ->
edit/post/delete; posted, not reversed -> reverse; reversed -> no actions.

## Journal numbering

`journal_no` is `NULL` for every draft. It is assigned **only** inside
`fin_post_journal()` / `fin_reverse_journal()`, per-entity and gapless:
`pg_advisory_xact_lock(hashtext('fin_journal_no:' || entity_id::text))` then
`SELECT COALESCE(max(journal_no), 0) + 1 FROM fin_journals WHERE entity_id =
...`. The advisory lock is transaction-scoped and keyed per entity, so two
concurrent posts for the *same* entity serialize on the number assignment
(no gap, no duplicate) while posts for *different* entities never block each
other. `formatJournalNo()` (`lib/ledger.js`) renders the assigned number as
`'#00012'`-style and a draft's `NULL` as `'Draft'`. The partial unique index
`uq_fin_journals_entity_no` on `(entity_id, journal_no) WHERE journal_no IS
NOT NULL` is the DB-level backstop against a duplicate ever landing.

## Multi-currency ready, single-currency now

Each journal has exactly one `currency` (ISO-3, e.g. `AUD`/`NPR`); the
validation trigger `fin_journal_lines_validate()` rejects any line whose
`currency` does not equal its journal's currency, at write time (draft or
not). `fin_journal_lines.fx_rate` (`numeric(18,8)`, `CHECK (fx_rate IS NULL
OR fx_rate > 0)`) exists as a reserved column for Phase 3+ FX support -
**nothing writes it in this milestone**, and there is no conversion anywhere
in the posting path. `fin_accounts.currency` is a separate, optional
constraint: `NULL` means "entity functional currency / unrestricted"; when
set, the posting RPC additionally requires every line against that account to
use exactly that currency.

## The four enforcement layers

The integrity of "documents post balanced journals; nothing writes posted
rows directly" is not just one check - it is four independent layers, each
closing a different bypass:

1. **RLS policy shape.** `fin_journals`: `INSERT ... WITH CHECK
   (is_accounts_app_user() AND status = 'draft')`; `UPDATE ... USING
   (is_accounts_app_user() AND status = 'draft') WITH CHECK
   (is_accounts_app_user() AND status = 'draft')`; `DELETE ... USING
   (is_accounts_app_user() AND status = 'draft')`. The `WITH CHECK` on
   `UPDATE` means a client can never flip a journal to `posted` even before
   the guard trigger below fires - the row simply fails to match the policy
   post-update. `fin_journal_lines` mirrors this by requiring the *parent*
   journal to be `status = 'draft'` on every INSERT/UPDATE/DELETE policy.
   `fin_accounts` has no `DELETE` policy at all (backstopped by its own guard
   trigger).
2. **Guard triggers, for every role.** `fin_journals_guard()`,
   `fin_journal_lines_guard()` and `fin_accounts_guard()`/
   `fin_accounts_parent_guard()` are `BEFORE` triggers - they fire regardless
   of RLS and regardless of `service_role` (which bypasses RLS but not
   triggers). They reject: any `UPDATE` of a posted journal (unconditional);
   `DELETE` of a posted journal; `DELETE`/structural writes on lines of a
   non-draft journal; `DELETE` on `fin_accounts` (archive instead); moving a
   line to a different journal; changing a frozen `entity_id`; reclassifying
   an account's `account_type`/`normal_balance` once any journal line
   references it; and a `parent_id` cycle or self-reference (depth-50 walk).
3. **Transaction-local posting gate, including the INSERT path.** A journal
   may only ever *become* `'posted'` while the session-local GUC
   `fl_accounts.ledger_posting` is set to `'on'` - and that GUC is set only
   inside `fin_post_journal()`/`fin_reverse_journal()`, immediately before
   the status-flipping `UPDATE`, and cleared immediately after. The shipped
   migration guards **both** paths a row could reach `status = 'posted'`
   through: `fin_journals_guard()` checks the GUC on `UPDATE draft ->
   posted` (as specified), and - beyond what the design spec called for -
   also checks it on **`INSERT ... status = 'posted'`** directly, which
   blocks a raw `service_role` `INSERT` from fabricating an already-posted
   row without ever going through the RPC. Because the GUC is
   transaction-local (`set_config(..., is_local => true)`), it can never leak
   across connections or be set by anything outside the RPC body.
4. **Deferred, commit-time balance backstop.** `fin_journals_balance_check()`
   is a `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`, `WHEN
   (NEW.status = 'posted')`, firing `AFTER INSERT OR UPDATE`. At commit time
   - not at statement time - it re-counts every journal that will end the
   transaction as `posted` and re-verifies: at least 2 lines exist; debits
   equal credits and the total is `> 0`; every line's currency matches the
   journal's; every line's account belongs to the journal's entity. This is
   deliberately a backstop against the **posting RPC itself**, not just
   against client writes - if a future code change to `fin_post_journal()`
   ever let an unbalanced journal through, the transaction still fails to
   commit.

## Entity isolation

Every line's account must belong to the journal's own entity -
`fin_journal_lines_validate()` enforces this eagerly at write time (draft or
posted): "account belongs to a different entity - cross-entity lines are not
allowed". The same trigger checks a tagged `bank_account_id` against the
journal's entity too. `fin_post_journal()`/`fin_reverse_journal()`
independently re-verify the same constraint at post time, and the deferred
balance-check trigger (layer 4 above) re-verifies it a third time at commit.
`entity_id` is frozen after insert on `fin_accounts` and `fin_journals`, so an
account or journal can never be silently re-homed to a different entity after
creation.

There is **no per-entity RLS partitioning** - `is_accounts_app_user()` gates
these three tables the same way it gates every other fl-accounts table; any
accounts-app user can read and write every entity's chart and journals. This
matches the platform-wide posture documented in [SECURITY.md](SECURITY.md)
and TECH_DEBT.md D17 - it is an accepted, explicit gap, not an oversight.

## What future modules will do

`fin_journals.source_type` reserves a vocabulary beyond what this milestone
produces: `'manual'` and `'reversal'` are the only two values written today;
`'bill'`, `'payroll'`, `'revenue'`, `'transfer'`, `'deposit'`, `'rebaseline'`,
`'opening_balance'` and `'system'` are CHECK-allowed but unused, reserved for
the modules that will post through this same engine - bills, payroll,
revenue and transfers all become *documents* that call `fin_post_journal()`
with their own generated draft, never write posted rows directly (see
[POSTING_ENGINE.md](POSTING_ENGINE.md) for exactly what a future module must
do). `source_id` is a polymorphic, nullable pointer to that future document's
own row, ready for the day a bill or a payroll snapshot needs to point back
at the journal it posted.

Payroll posting specifically will need to consume `payroll_run_snapshots`
(fl-accounts' finance-side mirror of fl-people's finalised runs), not a
locally-owned payroll run table - fl-accounts does not and will not own
`hr_payroll_runs`/`hr_payroll_items`; see the payroll split-ownership
decision in [ROADMAP.md](ROADMAP.md) and [ARCHITECTURE.md](ARCHITECTURE.md).
Re-baselining a float account will similarly become an `'opening_balance'` or
`'rebaseline'` journal instead of an in-place `starting_float` overwrite (see
[ARCHITECTURE_RECOMMENDATIONS.md](ARCHITECTURE_RECOMMENDATIONS.md)'s
migration path step 6) - not built in this milestone.
