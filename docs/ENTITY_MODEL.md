# Entity Model - fl-accounts

The multi-entity foundation: one registry (`fin_entities`) that every
financial record now references, an entity switcher in the UI, and a
retrofit path onto every existing table that keeps an already-deployed app
version working. Schema authored in `fl-crm/supabase/migrations`, migration
`20260711220000_fin_entities.sql`.

**Status: authored and committed to the fl-crm ledger, NOT yet applied to the
production Supabase project.** Until it is applied, the app runs a
pre-migration fallback described below - nothing in this document is live at
accounts.fundingloop.au yet. See ROADMAP.md for the apply/verify plan.

## Purpose

fl-accounts was Nepal-only in v1 (`float_accounts` had one row, entity/bank
account/baseline conflated - see FINANCIAL_SYSTEM_REVIEW.md). This migration
introduces a real entity concept so the AU entity (and any future entity) can
be added without a rewrite: **Funding Loop Pty Ltd** (`fl-au`, AUD, AU) and
**Funding Loop Nepal** (`fl-nepal`, NPR, NP) are seeded by the migration
itself; further entities are added through the `/entities` page with no
schema change required.

## `fin_entities` columns

| Column | Purpose |
|---|---|
| `id` | Primary key (uuid). |
| `code` | Stable machine key, e.g. `fl-au`, `fl-nepal`. See "The frozen code join key" below. |
| `legal_name` | Registered legal name. Required. |
| `trading_name` | Day-to-day name; shown in the UI ahead of `legal_name` when set. |
| `country_code` | ISO-2 (`AU`, `NP`). |
| `currency` | ISO-3 (`AUD`, `NPR`) - the entity's functional currency. |
| `registration_number` | ABN for AU, company registration number elsewhere. Entered by finance in the UI, not hard-coded. |
| `tax_identifier` | ABN/PAN-level identifier only. TFN is deliberately NOT stored here. |
| `timezone` | IANA timezone, e.g. `Australia/Sydney`. |
| `financial_year_start_month` | 1-12; defaults to 7 (July). Nepal's Shrawan FY is approximated to July in this AD-calendar system - see the seed row's `notes`. |
| `default_payroll_calendar` | `monthly` \| `fortnightly` \| `weekly`. |
| `status` | `active` \| `archived`. |
| `archived_at` | Set exactly when `status = 'archived'` (CHECK-enforced pairing). |
| `logo_path`, `notes` | Placeholders - storage/upload wiring for the logo comes later. |
| `created_at`, `updated_at`, `created_by` | Standard bookkeeping. |

## The frozen `code` join key

`code` is the cross-system identifier: `payroll_run_snapshots.entity_code`
(and, upstream, `hr_payroll_runs.entity_code` in fl-people) already stamps
this same string on every payroll run. `fin_entities.code` exists so that
string has somewhere authoritative to resolve to.

Because it is a join key spanning fl-accounts and fl-people, `code` is
**frozen after insert** by `fin_entities_guard()` - any `UPDATE` that changes
`code` raises. Renaming the entity's display is always `legal_name` /
`trading_name`, never `code`.

## Archive-only lifecycle

Entities are never hard-deleted. `fin_entities_guard()` raises on every
`DELETE`, for every role - it does not rely on RLS, so even `service_role`
(which bypasses RLS but not triggers) cannot delete a row. There is also no
`DELETE` policy in RLS. The only lifecycle transition is `status='active'` <->
`status='archived'` (with `archived_at` set/cleared to match), exposed in the
UI as **Archive** / **Restore** on `/entities`. Archived entities are hidden
from `activeEntities()` (used by the switcher and by pickers) but every row
that references them is untouched.

## `entity_id` retrofit

Every existing fl-accounts financial table gains a NOT NULL `entity_id`:

| Table | Backfill source |
|---|---|
| `float_accounts` | Direct: every existing row backfilled to `fl-nepal` (v1 was Nepal-only by construction). |
| `bills` | Via its `float_accounts` parent (`account_id`). |
| `float_deposits` | Via its `float_accounts` parent (`account_id`). |
| `payroll_employees` | Via its `float_accounts` parent (`account_id`). |
| `payroll_run_snapshots` | Via `entity_code` matched against the newly-seeded `fin_entities` rows. |

### Why old app versions keep working

`bills`, `float_deposits` and `payroll_employees` get a `BEFORE INSERT OR
UPDATE` trigger, `fl_accounts_derive_entity()`: if the incoming row's
`entity_id` is NULL, it is filled in from the row's `float_accounts` parent.
An app version deployed before this migration never sends `entity_id` at
all, so every write it makes is silently and correctly stamped - there is no
window where the currently-deployed app breaks because the migration landed
first.

### Why a contradicting `entity_id` is rejected

If a caller *does* supply an `entity_id` and it disagrees with the parent
float account's entity, the trigger raises rather than silently overwriting
either value. Cross-entity mixes (a bill on entity A's float account tagged
with entity B) are rejected outright, not "fixed" - the design explicitly
treats that as a data-integrity error, not a value to reconcile.

### The deliberate guard-disable for the snapshot backfill

`payroll_run_snapshots` is append-only by design (`trg_payroll_run_snapshots_guard`
blocks UPDATE/DELETE for every role - see the payroll snapshot docs and
TECH_DEBT D12). Backfilling `entity_id` onto existing rows is technically an
UPDATE, so the migration disables that guard trigger for the single backfill
statement, then re-enables it immediately after. The audit trigger is left
**enabled** throughout, so the backfill itself lands in
`fl_accounts_audit_log` like any other write. This is exactly the
"corrections require a deliberate manual migration, never an in-place edit"
path the snapshot design already documents - the backfill *is* that
deliberate migration, done once, in the open, with the guard back on before
the transaction commits. If any snapshot's `entity_code` has no matching
`fin_entities` row, the whole migration aborts (a `DO` block raises and rolls
back everything, guard re-enable included) rather than leaving an orphaned
snapshot.

## Updated `accounts_sync_payroll_snapshots()`

The RPC that captures finalised fl-people runs into `payroll_run_snapshots`
is re-created by this migration to also resolve and stamp `entity_id`. It now
**refuses to capture a run whose `entity_code` has no registered
`fin_entities` row** - raising rather than inserting a snapshot with no
entity. In practice this means a new entity must be added on `/entities`
(or by a future migration seed) before fl-people can finalise payroll runs
for it and have fl-accounts capture them. Everything else about the RPC's
contract (re-sum `hr_payroll_items` against the sealed header, `ON CONFLICT
(hr_run_id) DO NOTHING` idempotency, `is_accounts_app_user()` gate) is
unchanged from `20260711160000_payroll_run_snapshots.sql`.

## RLS summary

`fin_entities` follows the same shape as the other four fl-accounts tables:
SELECT/INSERT/UPDATE gated on `is_accounts_app_user()` for `authenticated`;
no DELETE policy (backstopped by the guard trigger above); `anon` gets
nothing; `service_role` has full access (bypasses RLS, not triggers). There
is **no per-entity partitioning** - any accounts-app user can read and write
every entity's row. See SECURITY.md for the platform-wide isolation posture.

## The virtual-entity fallback (pre-migration)

Until this migration is applied, `fin_entities` does not exist. `lib/useEntities.js`
detects that via `isMissingSchemaError()` and falls back to a single
**virtual entity** built by `virtualEntityFromFloatAccount()` in
`lib/entities.js`: `{ id: null, code: 'fl-nepal', legal_name: <the one
float_accounts row's name>, currency: <its currency>, virtual: true }`. The
`virtual: true` flag lets components (the switcher, `/entities`) disable
entity-management UI while still rendering a consistent single-entity
experience - the app behaves exactly as it did before this milestone. Every
page that reads `currentEntity` or `entities` from `useEntities()` works
unmodified against either the real registry or this fallback.

## Entity switcher UX

`EntitySwitcher` (rendered in `AppShell`'s sidebar on every page) lists
**Current** entity plus **All entities**, backed by `EntityProvider`
(`lib/useEntities.js`), which is mounted once at the root via
`components/Providers.js`. Selecting an entity or "All entities" is persisted
to `localStorage` (`fl-accounts.entity-selection`) so it survives reloads;
`resolveSelection()` falls back to the first active entity (by display-name
sort) if the stored value no longer matches a loaded entity (e.g. it was
archived). When the schema is missing, the switcher renders the virtual
entity as a disabled, non-interactive row instead of a dropdown.

Pages read `useEntities()` (full switcher API) or the narrower
`useCurrentEntity()` and branch on `allSelected`: dashboard, bills, float and
payroll each render a single-entity view scoped to `currentEntity` or a
group/all-entities view. Group views never sum figures across entities that
use different currencies - see `docs/FORECAST_MODEL.md` for the group
dashboard's per-currency rule.
