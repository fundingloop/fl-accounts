# Bank Account Model - fl-accounts

The per-entity bank account registry (`fin_bank_accounts`) and the transfer
workflow between accounts (`fin_transfers`), including intercompany
transfers. Schema authored in `fl-crm/supabase/migrations`, migration
`20260711230000_fin_bank_accounts.sql` (requires
`20260711220000_fin_entities.sql` applied first - foreign keys to
`fin_entities`).

**Status: authored and committed to the fl-crm ledger, NOT yet applied to the
production Supabase project.** `/banking` and `/transfers` degrade to an
amber "migration not applied yet" banner until it lands - see
`isMissingSchemaError()` handling in both pages. See ROADMAP.md for the
apply/verify plan.

## Registry, not a ledger

`fin_bank_accounts` is operational metadata - **not** a ledger. `current_balance`
is a finance-maintained figure, entered and updated by hand exactly like
`float_accounts.starting_float` was in v1, until the Phase 3 double-entry
ledger lands (see ARCHITECTURE_RECOMMENDATIONS.md). Two placeholders make
this explicit rather than implicit:

- The banking page's **Forecast balance** column always renders `-`; the
  page footer states "Forecast balance arrives with ledger integration
  (Phase 3)." There is no forecast-balance computation anywhere yet - the
  column exists so the eventual feature has a home in the UI.
- `last_reconciled_at` is a placeholder for a future reconciliation module;
  today it is either NULL (rendered as "Never reconciled") or whatever a
  user manually sets.

## Column reference

| Column | Purpose |
|---|---|
| `id`, `entity_id` | Primary key; owning entity (FK to `fin_entities`, frozen - see below). |
| `bank_name` | Institution name. |
| `account_name` | Account name/label. |
| `nickname` | Optional free-text shorthand. |
| `bsb` | AU-only routing code (`^\d{3}-?\d{3}$`); NULL for other countries. |
| `account_number` | Stored in full; masked in the UI - see below. |
| `currency` | ISO-3; does not have to match the entity's `currency` (e.g. an AU entity could theoretically hold a USD account), but nothing in the app reconciles a mismatch yet - see TECH_DEBT. |
| `account_type` | `operating` \| `payroll` \| `savings` \| `loan` \| `credit_card` \| `other`. |
| `is_primary` | At most one `true` per entity - see below. |
| `opening_balance`, `opening_balance_date` | Baseline balance and its as-of date. |
| `current_balance`, `balance_as_of` | Last known real balance and its as-of date. Deliberately unconstrained (no CHECK >= 0) - loans and credit cards may be negative by nature. |
| `status` | `active` \| `inactive` \| `closed`. |
| `last_reconciled_at`, `notes` | Placeholders (see above) / free text. |
| `created_at`, `updated_at`, `created_by` | Standard bookkeeping. |

## One primary account per entity

`uq_fin_bank_accounts_primary` is a **partial unique index** on
`(entity_id) WHERE is_primary` - at most one row per entity may have
`is_primary = true`. The banking page surfaces the resulting unique-violation
(`code 23505`, or a message match on `uq_fin_bank_accounts_primary`) as a
plain-English error: "Only one primary account is allowed per entity. Unset
the current primary account first, then try again." (`friendlyBankAccountError()`
in `app/banking/page.js`).

## Close-not-delete + frozen entity

`fin_bank_accounts_guard()` mirrors the entity guard's shape: `DELETE` raises
for every role ("bank accounts cannot be deleted; set status = closed
instead" - the UI exposes this as **Close**, which just sets
`status='closed'`), and `entity_id` is frozen after insert (moving an
account between legal entities would silently re-home its financial
history). Both checks fire regardless of role, including `service_role`.

## Account number: stored full, masked in the UI

`account_number` is stored in full - it is treated as a **payment routing
detail, not a secret credential** (the migration's own comment puts it in
the same sensitivity class as a BSB: useful for verifying you're paying the
right account, not something that grants access on its own). It is **always
masked in the UI**: `maskAccountNumber()` (`lib/entities.js`) replaces every
character but the last 4 with `•`, e.g. `123456789` -> `•••••6789`; short
values (<=4 chars) mask down to a fixed `••••` so a short number can't leak
its own length. Reads of `fin_bank_accounts` are restricted to accounts-app
users by RLS regardless (`is_accounts_app_user()`), same boundary as every
other fl-accounts table - masking is a UI-layer defence in depth on top of
that, not a substitute for it.

## `bills.bank_account_id` + same-entity trigger

This migration also adds `bank_account_id` (nullable FK to
`fin_bank_accounts`) and a `vendor` text placeholder to `bills` - which
account will pay the bill. `bills_bank_account_guard()` (a trigger named
`trg_bills_zz_bank_account_guard`, deliberately sorted after
`trg_bills_derive_entity` from the entities migration by BEFORE-trigger
alphabetical firing order, so `NEW.entity_id` is already resolved when this
guard runs) rejects any bank account that does not belong to the bill's own
`entity_id`. A bill for entity A can never be pointed at entity B's bank
account.

## `fin_transfers` workflow model

`fin_transfers` is a **workflow** table, not a ledger posting: it tracks
planned/actual cash movement between two bank accounts and nothing else.
Explicitly **no accounting journals yet** - the migration's own comment
states the workflow rows become journal *sources* once the Phase 3 ledger
exists, not that they post journals today.

**Status machine** (`fin_transfers_guard()`, fires for every role):

```
planned -> in_transit | settled | cancelled
in_transit -> settled | cancelled
settled, cancelled: terminal
```

Any other transition raises ("illegal transfer status transition: % -> %").
`nextTransferActions()` (`lib/banking.js`) mirrors this exactly for the UI's
row actions.

**Settled immutability**: once `status='settled'` (with `settled_at` set -
CHECK-enforced pairing), the row is fully locked - any further `UPDATE`
raises ("settled transfers are immutable"), because it represents money that
actually moved. A cancelled transfer cannot be reactivated. `DELETE` is only
permitted while `status` is `planned` or `cancelled`; deleting a `settled` or
`in_transit` transfer raises.

**Derived entity ids**: `from_entity_id` / `to_entity_id` are never
client-supplied - the guard trigger derives both from the referenced bank
accounts on every INSERT/UPDATE, so they cannot be spoofed and stay correct
even if application code has a bug. They are kept as real (not computed-at-read)
columns specifically so entity filtering and reporting need no join -
`transfersForEntity()` (`lib/banking.js`) filters in-memory on
`from_entity_id`/`to_entity_id` directly.

**`is_intercompany`**: a `GENERATED ALWAYS ... STORED` boolean, true exactly
when `from_entity_id IS DISTINCT FROM to_entity_id`. The transfers page badges
these rows "Intercompany". There is no special accounting treatment yet
(no intercompany receivable/payable posting - that is Phase 3, per
ARCHITECTURE_RECOMMENDATIONS.md's target `fin_transfers` design) - today it
is purely a workflow/reporting flag.

**Single-currency rows; FX deferred**: `fin_transfers.currency` is one ISO-3
value per transfer - there is no `fx_rate` column and no conversion. The
`from` and `to` bank accounts are allowed to hold different currencies (the
UI does not block it), and when they do, the transfers form shows an amber
warning ("FX rate handling arrives in Phase 3 - this transfer is recorded at
face value in the currency entered above"). The row is recorded at face
value only; reconciling that face value against two accounts in different
currencies is explicitly out of scope until Phase 3.

## RLS

`fin_bank_accounts`: SELECT/INSERT/UPDATE gated on `is_accounts_app_user()`
for `authenticated`; no DELETE policy (backstopped by the guard trigger).
`fin_transfers`: a single `FOR ALL` policy gated on `is_accounts_app_user()`
covering SELECT/INSERT/UPDATE/DELETE (DELETE is further restricted at the
trigger level to planned/cancelled rows, as above). Both: `anon` gets
nothing; `service_role` has full access. No per-entity partitioning in
either table - see SECURITY.md.
