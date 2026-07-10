# Chart of Accounts - fl-accounts

The per-entity chart of accounts, `fin_accounts` - the account dimension that
every `fin_journal_lines` row posts against. Part of migration
`20260711240000_fin_ledger.sql` (fl-crm ledger). See
[LEDGER_ARCHITECTURE.md](LEDGER_ARCHITECTURE.md) for how this table fits into
the wider ledger spine, and [POSTING_ENGINE.md](POSTING_ENGINE.md) for how an
account's `status`/`is_postable`/`currency` are enforced at post time.

**Status: authored and committed to the fl-crm ledger, NOT yet applied to the
production Supabase project.** `/ledger/accounts` degrades to an amber
"migration not applied yet" banner until it lands - see
`isMissingSchemaError()` handling on the page. See ROADMAP.md for the
apply/verify plan.

## Column reference

| Column | Purpose |
|---|---|
| `id` | Primary key (uuid). |
| `entity_id` | Owning entity (FK to `fin_entities`). Frozen after insert - see below. |
| `code` | Account code, e.g. `1000`. `CHECK (code ~ '^[0-9A-Za-z][0-9A-Za-z.-]{0,19}$')`; unique per entity (`UNIQUE (entity_id, code)`). |
| `name` | Display name. `CHECK (length(trim(name)) > 0)`. |
| `account_type` | One of the 8 types below. Frozen once any journal line references the account - see below. |
| `normal_balance` | `'debit'` \| `'credit'`. Free choice, independent of `account_type` - see "Contra accounts" below. Frozen alongside `account_type`. |
| `parent_id` | Optional same-entity parent account, for grouping/reporting. See "Same-entity parent" below. |
| `currency` | `NULL` (entity functional currency / unrestricted) or an ISO-3 code (`CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$')`). When set, posting requires every line's currency to equal it. |
| `is_postable` | `true` (default) = journal lines may post to it; `false` = a header/grouping account that rejects postings at POST time. |
| `status` | `'active'` \| `'archived'`. Archive-only lifecycle - see below. |
| `archived_at` | Set exactly when `status = 'archived'` (CHECK-enforced pairing, same shape as `fin_entities`). |
| `description` | Free text, optional. |
| `created_at`, `updated_at`, `created_by` | Standard bookkeeping. |

## The 8 account types and normal balance defaults

`ACCOUNT_TYPES` in `lib/ledger.js` is the ordered array the UI groups and
renders by; it mirrors `fin_accounts.account_type`'s CHECK constraint
exactly:

| `value` (stored) | `label` (UI) | Default `normalBalance` |
|---|---|---|
| `asset` | Assets | debit |
| `liability` | Liabilities | credit |
| `equity` | Equity | credit |
| `income` | Income | credit |
| `cost_of_sales` | Cost of sales | debit |
| `expense` | Expenses | debit |
| `other_income` | Other income | credit |
| `other_expense` | Other expense | debit |

`normalBalanceForType(type)` (`lib/ledger.js`) returns this default, used to
pre-fill `normal_balance` in the chart-of-accounts add/edit form when
`account_type` changes; an unknown/null type defaults to `'debit'` rather
than throwing. `accountTypeLabel(type)` renders the label, falling back to
the raw value for anything not in the table.

### Contra accounts

`normal_balance` is a genuinely free choice, independent of `account_type` -
the CHECK constraint only restricts it to `'debit'`/`'credit'`, it does not
tie it to the account's type. This is deliberate: a contra-asset (e.g.
accumulated depreciation, normal balance credit, filed under `asset`) or a
contra-liability is representable. The UI only *defaults* `normal_balance`
from the type via `normalBalanceForType()`; nothing prevents overriding it.

## Per-entity code uniqueness

`UNIQUE (entity_id, code)` - two different entities may both have a `1000`
account; the same entity cannot. The chart-of-accounts page surfaces the
resulting Postgres `23505` unique-violation as a plain-English message ("An
account with this code already exists for this entity.") via
`friendlyAccountError()` in `app/ledger/accounts/page.js`, falling through to
the raw error message for anything else (including the guard trigger's
frozen-field raises, which are already written to be read directly).

## Same-entity parent: composite FK + cycle guard

`parent_id` is same-entity **by construction**, not just by trigger:
`UNIQUE (id, entity_id)` on the table plus a composite foreign key
`FOREIGN KEY (parent_id, entity_id) REFERENCES fin_accounts (id, entity_id)`
makes it structurally impossible for `parent_id` to reference a row whose
`entity_id` differs from the child's own `entity_id` - there is no value the
database would even accept. On top of that, `fin_accounts_parent_guard()`
(`BEFORE INSERT OR UPDATE OF parent_id`) walks the parent chain (max depth
50) and raises on a direct self-reference (`NEW.parent_id = NEW.id`) or any
cycle found while walking. This guard fires independently of
`fin_accounts_guard()` (which only fires on `UPDATE OR DELETE`) specifically
because it needs to run on `INSERT` too.

The chart-of-accounts UI groups by type via `accountsByType()`
(`lib/ledger.js`): within a type, active accounts sort before archived, then
by `code`; a child account is placed immediately after its parent
(single-level indent - a child's own children are not further nested).

## Postable vs header accounts

`is_postable = false` marks a header/grouping account - it exists for chart
structure and reporting only. `fin_post_journal()` rejects any line posted
against a non-postable account ("account % is not postable", naming the
account code); `postableAccounts()` (`lib/ledger.js`, `active AND
is_postable`, sorted by code) is what populates the account picker in the
journal-lines editor, so a header account is never offered as a postable
choice in the first place - the RPC check is the backstop for anything that
bypasses the UI (a direct write, or a stale client).

## Archive-only lifecycle

Accounts are never hard-deleted. `fin_accounts_guard()` raises on every
`DELETE`, for every role, including `service_role` (triggers fire regardless
of RLS bypass) - "accounts cannot be deleted; archive them instead (status =
archived)". There is also no `DELETE` RLS policy. The only lifecycle
transition is `status='active'` <-> `status='archived'` (with `archived_at`
set/cleared to match, CHECK-enforced), exposed in the UI as **Archive** /
**Restore**. Archiving asks for confirmation naming the consequence ("It will
be hidden from postable-account pickers; existing journal lines are
preserved.") - archiving does not touch, hide, or in any way affect journal
lines that already reference the account; it only removes it from
`postableAccounts()` going forward. Because `is_postable`/`status='active'`
are re-checked at POST time (not at draft-write time), a draft referencing a
since-archived account stays fully editable/deletable - it simply cannot be
posted until the account is restored or the line is repointed.

## Frozen fields

- **`entity_id` - always frozen after insert.** `fin_accounts_guard()`
  raises on any `UPDATE` that changes it ("account entity is frozen after
  creation"). An account can never be moved between legal entities.
- **`account_type` / `normal_balance` - frozen once any journal line
  references the account.** `fin_accounts_guard()` checks, on `UPDATE`,
  whether either field is changing; if so it queries `EXISTS (SELECT 1 FROM
  fin_journal_lines WHERE account_id = OLD.id)` (draft **or** posted lines
  count) and raises if any line exists ("account type and normal balance are
  frozen once journal lines reference this account"). Reclassifying an
  account's type/normal balance after it has already been used would corrupt
  any reporting built on those lines. `code` and `name` are display-only and
  stay editable regardless of usage.

## The seeded starter chart

The migration seeds an identical core chart of accounts for **both** entities
seeded by `20260711220000_fin_entities.sql` (`fl-au`, `fl-nepal`),
idempotently (`WHERE NOT EXISTS` per entity + code). Every seeded account has
`currency = NULL`, `is_postable = true`:

| Code | Name | Type | Normal balance |
|---|---|---|---|
| 1000 | Cash at bank | asset | debit |
| 1100 | Accounts receivable | asset | debit |
| 2000 | Accounts payable | liability | credit |
| 2100 | Payroll liabilities | liability | credit |
| 3000 | Owner's equity | equity | credit |
| 3100 | Retained earnings | equity | credit |
| 3900 | Opening balances | equity | credit |
| 4000 | Revenue | income | credit |
| 5000 | Cost of sales | cost_of_sales | debit |
| 6000 | General expenses | expense | debit |
| 6100 | Salaries and wages | expense | debit |
| 6200 | Bank fees | expense | debit |
| 7000 | Other income | other_income | credit |
| 8000 | Other expenses | other_expense | debit |

That is 14 accounts per entity (fl-au ends here). `fl-nepal` additionally
gets two statutory payable accounts, anticipating future payroll posting
(the SSF/TDS liabilities `payroll_run_snapshots` already tracks - see
[ARCHITECTURE.md](ARCHITECTURE.md)):

| Code | Name | Type | Normal balance |
|---|---|---|---|
| 2110 | SSF payable | liability | credit |
| 2120 | TDS payable | liability | credit |

That brings `fl-nepal` to **16 accounts**; `fl-au` has **14**. The
migration's own POST-APPLY VERIFICATION block checks exactly these two
counts.

## No auto-seed for future entities

This starter chart is a **one-time seed for the two entities that exist
today** - there is no auto-seed-on-entity-creation hook in this milestone. An
entity registered later via `/entities` starts with a **completely empty**
chart of accounts; someone must add accounts by hand on `/ledger/accounts`
before that entity can post any manual journal (or, eventually, any
document). This is a deliberate scope limit, not an oversight - see
TECH_DEBT.md.

## The `/ledger/accounts` UI

Client component (`app/ledger/accounts/page.js`) under the shared
`LedgerTabs` sub-nav ("Journal entries" | "Chart of accounts"). Loads
`fin_accounts` scoped to `currentEntity` (or every entity, with an added
Entity column, when "All entities" is selected) and groups the result with
`accountsByType()` for rendering.

- **Add/Edit modal**: code, name, type (select, drives the normal-balance
  default via `handleTypeChange`), normal balance (editable), parent account
  (same-entity options only, excluding the account being edited, sorted by
  code), currency (optional, uppercased on input, blank = "Entity default"),
  a "Postable" checkbox, description.
- **Archive/Restore**: a confirm dialog naming the consequence, then flips
  `status`/`archived_at`; never a delete action anywhere in the UI.
- **Duplicate-code errors** surface via `friendlyAccountError()` as described
  above.
- **All-entities mode is read-only**: "Add account" is disabled with a
  `title` hint ("Select a single entity to add an account."), and the
  per-row Edit/Archive/Restore actions are hidden entirely when `allSelected`
  is true - the page still renders every entity's chart (with an Entity
  column) for browsing.
