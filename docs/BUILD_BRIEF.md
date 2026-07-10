# FL Accounts - Build Brief for Claude Code

## What we're building
An internal accounts-payable and cashflow tool for the Nepal team. Manisha and admins log bills/invoices, mark them paid, track the Nepal bank float, and see a 6-month cashflow forecast. It is a separate front-end app that shares one Supabase project with the CRM.

## Architecture (locked)
- New standalone Next.js 14 app in its own repo: **fl-accounts**.
- Points at the **same Supabase project** as fl-crm (same auth, same database).
- Separate deployment and subdomain, so Nepal users have no CRM routes to reach in the first place.
- Schema changes go through **fl-crm's** migration ledger (single source of truth). fl-accounts owns **no** migrations - it is a pure front end over existing tables.

## One decision to confirm before starting (domain drives auth)
- **Recommended:** `accounts.fundingloop.com.au` (same root as `crm.fundingloop.com.au`), so the Supabase session cookie shares across both apps and the CRM admin tile links straight in with no re-login.
- **Alternative:** `accounts.fundingloop.au` - fine, but crossing from the CRM tile needs a fresh login because it is a different root domain. Acceptable since only admins ever cross.
- This brief assumes the com.au subdomain. If we keep .au, only the domain changes, nothing else.

## Repo setup
- Location: `C:\Users\KennethTang\Desktop\fl-accounts` (adjust the parent folder if preferred).
- Stack: Next.js 14 App Router, Supabase, Tailwind. Match fl-crm's versions.
- `.env.local`: reuse the CRM's `NEXT_PUBLIC_SUPABASE_URL` and anon key (same project). Add `SUPABASE_SERVICE_ROLE_KEY` for the server routes that handle invoice files.

## Database - add via a migration IN fl-crm
Create one migration, file-first: `supabase migration new fl_accounts_tables`, then `supabase db push`. Grep existing migrations for name collisions before adding.

**float_accounts**
- id uuid pk default gen_random_uuid()
- name text not null
- currency text not null default 'NPR'
- starting_float numeric not null default 0
- float_as_of_date date not null default current_date
- created_at, updated_at timestamptz
- Seed one row: name 'Nepal', currency 'NPR'.

**bills**
- id uuid pk
- account_id uuid not null references float_accounts(id)
- description text not null
- category text
- charge_type text not null check in ('one_off','recurring')
- recurrence text null check in ('weekly','fortnightly','monthly','quarterly','annually')
- amount numeric not null
- invoice_date date
- due_date date
- paid boolean not null default false
- paid_date date null
- attachment_path text null
- created_at, updated_at timestamptz, created_by uuid

**float_deposits**
- id uuid pk
- account_id uuid not null references float_accounts(id)
- deposit_date date not null
- amount numeric not null
- note text
- created_at timestamptz, created_by uuid

Notes: `account_id` everywhere makes this multi-account ready for free. v1 uses the single Nepal row. All amounts are in the account currency for v1, no per-bill currency yet.

## Roles and RLS - the security boundary (most important part)
- Add a new role value **'accounts'** to the CRM's existing role system (admin / manager / bd_rep / read_only, plus accounts).
- Enable RLS on all three new tables. Policies: admin, manager, accounts get full CRUD. bd_rep and read_only get no access.
- **CRITICAL:** an 'accounts' user is an authenticated Supabase user, so they can query the database directly. Before shipping, audit CRM table policies and confirm none grant blanket "authenticated can read" access. Every CRM table policy must be role-scoped, so an accounts user with a valid token still cannot read leads, deals, lenders, or partners. This is the same class as the vestigial lender public-read policies flagged earlier. Fix any blanket policies found.

## Storage - invoice/receipt files
- Private bucket: `account-invoices`.
- Path convention: `{account_id}/{bill_id}/{filename}`.
- Do **not** use a broad client-side storage policy. Handle upload and download through fl-accounts server routes using the service role key, with ownership checks in code (confirm the user's role and that the bill belongs to their account before returning a signed URL). Same pattern as the CRM customer-doc approach.

## App structure (fl-accounts)
Routes (App Router):
- `/login` - Supabase email auth.
- middleware: require authenticated **and** role in (accounts, manager, admin), else redirect to `/login`. Deny everything else.
- `/` - Dashboard
- `/bills` - Bills and invoices
- `/float` - Float and deposits

Brand: navy #012E41, teal #2BA99F, Poppins throughout. Copy the tokens and the handful of components you need from fl-crm. Do **not** extract a shared @fl/ui package yet.

## Features (behaviour matches the prototype already built)
**Float tab**
- Set the account starting float, currency, and "balance as of" date.
- Log top-ups/deposits (date, amount, note). Future-dated deposits feed the forecast.
- Show reconciliation: starting float + deposits in - bills paid out = balance now.
- "Re-baseline to actual" action: enter the real bank balance today; it sets starting_float to that value and float_as_of_date to today. This resets accumulated drift (fees, FX, unlogged spend). Encourage periodic use. This is a forecast, not a bank feed.

**Bills tab**
- CRUD bills. Fields: description, category (free text with a suggested list), charge_type one-off/recurring, recurrence, amount, invoice_date, due_date.
- Mark paid/unpaid (paid sets paid_date to today).
- Attach an invoice/receipt (image or PDF).
- Filters: all / unpaid / overdue / paid. Overdue = unpaid and due_date before today.
- Purpose-built finance table with a totals row. Do not force-fit the CRM's generic RecordTable.

**Dashboard**
- Hero: current float balance.
- Cards: outstanding (unpaid total), overdue (count and amount), due in next 7 days.
- Cashflow forecast chart (6 months, recharts area, stepAfter). If projected balance dips below 0, warn with the date so a top-up can be planned in time.

## Forecast logic (client-side util, no Postgres function)
- currentBalance = starting_float + sum(deposits dated between float_as_of_date and today) - sum(paid bills whose paid_date is between float_as_of_date and today).
- Project 6 months forward from today:
  - recurring bills: generate occurrences from due_date stepping by recurrence; if the anchor instance is already paid, start from the next occurrence; include occurrences from today up to the horizon as outflows.
  - unpaid one-offs: outflow on due_date (or today if overdue).
  - future-dated deposits: inflows on their date.
- Walk events in date order from currentBalance to build a running-balance series; capture the lowest point and its date for the warning.

## Do NOT build (keep it lean)
- No NBA engine.
- No shared @fl/ui package yet - copy what you need.
- No Postgres forecast function - client-side is fine at this volume.
- No per-occurrence payments table yet - the single paid flag is enough for v1. If true month-by-month historical actuals are needed later, add a payments table and design it as an additive change, not a rewrite.
- No multi-currency yet - single account currency (NPR). Per-bill currency and FX is a documented future addition.

## fl-crm side (small)
- Add an admin-only nav item "Nepal Accounts" linking to the accounts domain. Visible to admin (and optionally manager) only.

## Conventions (house rules - follow exactly)
- No em-dashes anywhere. Hyphens only.
- Use `!== undefined`, not `??`, for optional UPDATE guards.
- Grep migrations for column names before adding them to SELECTs or UPDATEs.
- PowerShell: no `&&`; put commands on separate lines; use `Remove-Item`, not `rm -f`.
- Migrations are file-first: `supabase migration new`, then `supabase db push`.
- Match fl-crm's Next.js 14 / Supabase / Tailwind setup and code style.

## Suggested build order
1. fl-accounts repo init, env, Supabase client, auth, role-gated middleware.
2. fl-crm migration: three tables, accounts role, RLS, storage bucket and policies. Audit CRM policies for blanket-authenticated access.
3. Float tab (set float, deposits, re-baseline, reconciliation).
4. Bills tab (CRUD, attachments via server routes, mark paid, filters, totals).
5. Dashboard and forecast chart.
6. fl-crm admin tile linking across.
