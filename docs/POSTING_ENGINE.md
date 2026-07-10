# Posting Engine - fl-accounts

The only path from a draft journal to a posted one: the two Postgres RPCs
`fin_post_journal()` / `fin_reverse_journal()` and the two Next.js server
routes that call them. Part of migration `20260711240000_fin_ledger.sql`
(fl-crm ledger). See [LEDGER_ARCHITECTURE.md](LEDGER_ARCHITECTURE.md) for how
posting fits into the wider ledger spine (the four enforcement layers,
journal numbering, the derived "reversed" state) and
[CHART_OF_ACCOUNTS.md](CHART_OF_ACCOUNTS.md) for the account-level checks
referenced below.

**Status: authored and committed to the fl-crm ledger, NOT yet applied to the
production Supabase project.** `app/api/ledger/post/route.js` and
`app/api/ledger/reverse/route.js` exist and are wired into the UI, but the
underlying RPCs do not exist until the migration lands - a call against the
unapplied schema fails as a missing-function error, which the routes report
as a generic 500 (there is no `isMissingSchemaError()` short-circuit inside
these two routes; the missing-schema banner lives on the pages that read
`fin_journals`/`fin_accounts` directly). See ROADMAP.md for the apply/verify
plan.

## `fin_post_journal(p_journal_id uuid, p_actor_id uuid) RETURNS bigint`

Posts a draft journal in place and returns its assigned `journal_no`.
Validations run in this order, each raising a specific, English-language
message on failure:

1. **Actor check** (see "Why `p_actor_id` is explicit" below) - raises `not
   authorised` if it fails.
2. `SELECT ... FROM fin_journals WHERE id = p_journal_id FOR UPDATE` - raises
   `journal % not found` if no row; raises `only draft journals can be
   posted` if `status <> 'draft'`. The `FOR UPDATE` lock is held for the rest
   of the transaction, so two concurrent posts of the same journal serialize.
3. The journal's entity must exist and be `status = 'active'` - raises
   `journal entity is not active` otherwise.
4. Every line is loaded ordered by `line_no`. If there are zero lines, raises
   `a journal needs at least one debit and one credit line`.
5. **Per line**, in order: the account must exist (`account % not found`);
   must belong to the journal's entity (`line references an account from a
   different entity`); must be `status = 'active'` (`account % is not
   active`, naming the account code); must be `is_postable` (`account % is
   not postable`); the line's currency must equal the journal's currency
   (`line currency does not match the journal currency`); if the account has
   a non-NULL `currency`, the line's currency must equal it too (`line
   currency does not match account % currency`).
6. **Balance**: `SUM(debit) = SUM(credit)` and the total is `> 0`, else
   `journal does not balance: debits % vs credits %` (with the actual
   figures interpolated).
7. **Numbering**: `pg_advisory_xact_lock(hashtext('fin_journal_no:' ||
   entity_id::text))`, then `v_no := COALESCE(max(journal_no), 0) + 1` scoped
   to the entity - see [LEDGER_ARCHITECTURE.md](LEDGER_ARCHITECTURE.md)'s
   "Journal numbering" for why this is gapless.
8. **Commit the transition**: `set_config('fl_accounts.ledger_posting',
   'on', true)`, then `UPDATE fin_journals SET status = 'posted', journal_no
   = v_no, posted_at = now(), posted_by = p_actor_id, posted_by_name =
   v_actor_name`, then `set_config('fl_accounts.ledger_posting', '', true)`
   immediately after - the GUC is set only for the duration of that one
   `UPDATE`. The audit trigger (`fl_accounts_audit`) journals the update
   automatically, same as every other fl-accounts write.
9. Returns `v_no`.

## `fin_reverse_journal(p_journal_id uuid, p_actor_id uuid, p_journal_date date DEFAULT NULL, p_description text DEFAULT NULL) RETURNS uuid`

Creates a new draft reversal journal with debit/credit swapped on every line,
then posts it in the same transaction, returning the **new** journal's id.

1. Actor check (same as above).
2. Lock + load the original: `journal % not found` if missing; `only posted
   journals can be reversed` if `status <> 'posted'`.
3. `EXISTS (SELECT 1 FROM fin_journals WHERE reverses_journal_id =
   p_journal_id)` - raises `journal % has already been reversed` if true. The
   partial unique index `uq_fin_journals_reverses` is the race backstop for
   this check (see [LEDGER_ARCHITECTURE.md](LEDGER_ARCHITECTURE.md)).
4. Inserts the new draft: same `entity_id` and `currency` as the original,
   `source_type = 'reversal'`, `reverses_journal_id` = the original's id,
   `journal_date = COALESCE(p_journal_date, current_date)`, `description =
   COALESCE(NULLIF(trim(p_description), ''), 'Reversal of journal #' ||
   original.journal_no || ': ' || original.description)`, `created_by =
   p_actor_id`.
5. Inserts one line per original line, in the same `line_no` order, with
   `account_id`/`currency`/`bank_account_id`/`memo` preserved and **debit and
   credit swapped**.
6. **Posts the new reversal in-transaction**, re-running essentially the same
   steps as `fin_post_journal()` above (entity active, per-line entity match,
   per-line currency checks, balance, advisory-lock numbering, the
   `ledger_posting` GUC dance, the header `UPDATE`) - with exactly **one**
   deliberate relaxation, described below.
7. Returns the new journal's `id`.

### The one deliberate relaxation

Reversal posting **skips the account `status = 'active'` / `is_postable`
check** that `fin_post_journal()` enforces on every line (step 5 above) -
reversing out of a since-archived account is a legitimate correction, and
requiring it to be un-archived first would make some corrections impossible.
Every other check still applies in full: the account must still exist and
belong to the same entity, line currency must still match the journal (and
the account's currency, if set), and the journal must still balance. This is
the *only* narrowing versus `fin_post_journal()` - nothing else about
posting is relaxed for a reversal.

## Why `p_actor_id` is explicit, and how it is re-verified

Both RPCs are `SECURITY DEFINER`, `VOLATILE`, and callable **only** by
`service_role` - `REVOKE ALL ... FROM PUBLIC, anon, authenticated` then
`GRANT EXECUTE ... TO service_role`, on both `fin_post_journal` and
`fin_reverse_journal` (and on the shared actor-check helper,
`fin_ledger_check_actor`). Because a `service_role` call carries no JWT,
`auth.uid()` is `NULL` in that execution context - there is no session to
read the acting user from. The acting user is therefore an **explicit
parameter**, `p_actor_id`, supplied by the calling Next.js route *after* its
own role gate has already run.

Passing an actor id as a plain parameter would be meaningless as a security
control on its own - anything with `service_role` access could pass any uuid.
So the RPC does not trust it: `fin_ledger_check_actor(p_actor_id)` **is the
independent re-verification** - it looks the id up directly against
`team_members` (`user_id = p_actor_id AND active AND role_type IN
('accounts', 'manager', 'admin')`), raises `not authorised` if no matching
row exists, and otherwise returns the actor's `full_name` (stored as
`posted_by_name`, so a UI can show who posted without a join). This runs as
the very first step of both RPCs, before any journal is even looked up - the
server route's own role gate is a fast, cheap early-exit, not the actual
security boundary; the RPC's actor check is.

## Service-role-only EXECUTE grants

```
REVOKE ALL ON FUNCTION public.fin_post_journal(uuid, uuid)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fin_reverse_journal(uuid, uuid, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fin_ledger_check_actor(uuid)      FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fin_post_journal(uuid, uuid)             TO service_role;
GRANT EXECUTE ON FUNCTION public.fin_reverse_journal(uuid, uuid, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fin_ledger_check_actor(uuid)             TO service_role;
```

Posting is server-side only, by construction: even an authenticated
accounts-role user calling either RPC directly (e.g. via `supabase.rpc(...)`
from the browser) gets a permission-denied error - there is no grant to
`authenticated` at all. The migration's own POST-APPLY VERIFICATION block
checks exactly this.

## The two server routes

Both `app/api/ledger/post/route.js` (`POST { journal_id }`) and
`app/api/ledger/reverse/route.js` (`POST { journal_id, journal_date?,
description? }`) follow the same four-step order, documented in a comment at
the top of each route (house style, matching `app/api/bills/delete/route.js`):

1. **Role gate.** `createCookieClient()` -> `resolveMember()` -> reject with
   403 unless `roleAllowed(member.role_type)` (`accounts`/`manager`/`admin`,
   `lib/roles.js` - the same set the RPC's actor check accepts). Cheap, no DB
   write; this is a fast early-exit, not the sole guard (see above).
2. **Body validation.** `journal_id` must be a string (400 otherwise); the
   reverse route additionally validates `journal_date` against
   `^\d{4}-\d{2}-\d{2}$` and `description` against `typeof === 'string'` when
   present (400 on either mismatch).
3. **Defense-in-depth read, under the caller's own RLS client**
   (`createCookieClient()`, not the service client): load `id, status,
   entity_id` from `fin_journals`. `404` if the caller cannot even see the
   row (RLS-invisible or genuinely absent); `409` if it's the wrong status
   for the operation (`post` requires `status = 'draft'`, `reverse` requires
   `status = 'posted'`) - this is a fast, friendly pre-check entirely
   separate from the RPC's own status re-check, which is the actual gate.
4. **Call the RPC with the service client** (`createServiceClient()`),
   passing `p_actor_id: user.id`. This is the durable point: on success the
   journal is posted (or the reversal exists and is posted) and its
   `journal_no` assigned; the route reports that back honestly. On error,
   the raw Postgres error is mapped through `friendlyPostingError()`
   (`lib/ledgerPostingErrors.js`).

### `friendlyPostingError()` and the 422 vs 500 split

`lib/ledgerPostingErrors.js` matches the RPC's raised message against a list
of known patterns (`not authorised`, `only draft journals`, `only posted
journals`, `does not balance`, `at least one debit and one credit`, `is not
postable`, `is not active`, `different entity`, `currency`, `already been
reversed` / `already reversed`, `not found`). A match is passed through
**verbatim** to the client - the RPC's `RAISE EXCEPTION` messages are already
written in plain English for exactly this purpose (e.g. "journal does not
balance: debits 100.00 vs credits 80.00" is both the DB error and the UI
error) - and the route responds **422** with that message. Anything that
doesn't match is replaced with a generic "Could not complete this action..."
message, the raw error is `console.error`'d server-side, and the route
responds **500** - the caller cannot act on an error it doesn't recognise, so
it is not shown the internal detail (same "log internal, return generic"
rule as every other fl-accounts route, see SECURITY.md's standing rules).

## Gapless numbering via advisory lock

Covered in full in [LEDGER_ARCHITECTURE.md](LEDGER_ARCHITECTURE.md)'s
"Journal numbering" section - both RPCs use the identical pattern
(`pg_advisory_xact_lock` keyed per entity, then `max(journal_no) + 1`) so
that posting and reversal-posting share one gapless sequence per entity.

## The honest-failure contract

`app/ledger/new/page.js`'s "Save & post" button performs two separate steps
client-side: it saves the draft (header + lines, under RLS, exactly like
"Save draft") **first**, then calls `POST /api/ledger/post` with the
resulting `journal_id`. If the draft save fails, nothing is posted and the
form shows the error with the user's input intact (standard fl-accounts form
behaviour). If the draft save **succeeds** but the post call fails - for any
reason, including a network failure reaching the route at all - **the draft
is left exactly as saved**; the UI navigates to `/ledger/[id]` with the
posting error surfaced via a `?postError=` query param, so the user lands on
a real, inspectable draft with an honest explanation of why it didn't post,
rather than a fake success or a lost draft. The same honest-failure pattern
applies to the Post and Reverse actions on the journal detail page
(`app/ledger/[id]/page.js`): a failed `fetch` or a non-OK response sets the
page's own error banner and leaves the journal in its prior state; nothing
ever claims success it didn't actually confirm from the server.

## What a future module must do to post

There is exactly one supported path onto a posted journal, and it is the
same path for every source, present or future: **create a draft journal +
its lines (ordinary RLS-gated inserts, or service-role inserts from a
document's own posting flow), then call `fin_post_journal()`**. Nothing -
not a future bill-payment flow, not payroll posting, not revenue capture -
writes to `fin_journals`/`fin_journal_lines` with `status = 'posted'`
directly; the guard triggers and the `fl_accounts.ledger_posting` GUC (see
[LEDGER_ARCHITECTURE.md](LEDGER_ARCHITECTURE.md)'s enforcement layer 3) make
that structurally impossible even for a `service_role` caller that tries. A
future module supplies its own `source_type` (from the reserved vocabulary -
`bill`, `payroll`, `revenue`, `transfer`, `deposit`, `rebaseline`,
`opening_balance`, `system`) and `source_id` on the draft header so the
journal can be traced back to the document that produced it; everything
downstream of "draft exists and balances" is identical to a manual journal.
