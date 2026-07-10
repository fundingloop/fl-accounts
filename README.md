# fl-accounts

Funding Loop's internal finance app - today: multi-entity accounts payable,
float tracking, cashflow forecasting, the SSF payroll register, a read-only
mirror of finalised fl-people payroll runs (payroll history + payroll in the
forecast), a bank account registry and a transfer workflow (including
intercompany transfers). Long-term: the company-wide finance and operations
platform (see [docs/ROADMAP.md](docs/ROADMAP.md)).

Pages: Dashboard, Bills, Float, Payroll, Banking, Transfers, Entities,
Security - each entity-aware via a persistent entity switcher (Current /
All entities). The entity, bank account and transfer schema
(`fin_entities`, `fin_bank_accounts`, `fin_transfers`) is authored and
committed to the fl-crm ledger but **not yet applied** to production - see
[docs/ENTITY_MODEL.md](docs/ENTITY_MODEL.md) and
[docs/BANK_ACCOUNT_MODEL.md](docs/BANK_ACCOUNT_MODEL.md). Until it is
applied, the app degrades gracefully to a single virtual Nepal entity.

- **Live**: accounts.fundingloop.au (own Vercel project)
- **Stack**: Next.js 14 App Router (plain JS), Supabase (shared project with
  fl-crm - same auth, same Postgres), Tailwind, Recharts.
- **Access**: active `team_members` with role `accounts`, `manager` or
  `admin`. TOTP MFA is enforced for any user who has enrolled a factor
  (enrol at `/security`).

## Development

```
npm install
npm run dev        # http://localhost:3000
npm test           # vitest - forecast / payroll / payroll snapshots / payroll forecast / format maths
npm run lint
npm run build
```

GitHub Actions CI (`.github/workflows/ci.yml`) runs the same gate - `npm ci`,
`npm test`, `npm run lint`, `npm run build` - on every push and pull request.
The workflow is live and green.

`.env.local` (never committed):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # server routes only (file handling, cleanup)
```

## Database rules (important)

This app owns **no migrations**. All schema for its tables lives in
**fl-crm's** migration ledger (`fl-crm/supabase/migrations`) and is applied
manually with `supabase db push` - never automatically and never from this
repo. Each migration carries pre-apply checks, post-apply verification and
rollback SQL in comments. Grep the ledger before referencing any column.

Tables: `float_accounts`, `bills`, `float_deposits`, `payroll_employees`,
`payroll_run_snapshots`, `fl_accounts_audit_log` (+ the
`is_accounts_app_user()` / `rls_team_members_self_read` RLS pieces).
`payroll_run_snapshots` is an append-only finance mirror of finalised
fl-people payroll runs (`hr_payroll_runs`/`hr_payroll_items` - owned by
fl-people, not this app) - see ARCHITECTURE.md. Storage: private
`account-invoices` bucket, server-route access only.

Two further tables are authored in the ledger but **not yet applied**:
`fin_entities` (legal entity registry) and `fin_bank_accounts` /
`fin_transfers` (bank account registry + transfer workflow), plus an
`entity_id` retrofit onto `float_accounts`/`bills`/`float_deposits`/
`payroll_employees`/`payroll_run_snapshots`. See
[docs/ENTITY_MODEL.md](docs/ENTITY_MODEL.md) and
[docs/BANK_ACCOUNT_MODEL.md](docs/BANK_ACCOUNT_MODEL.md).

## Documentation

Start at [DOCS_INDEX.md](DOCS_INDEX.md). House rules from the original build
brief still apply: no em-dashes; file-first migrations; PowerShell syntax in
scripts; match fl-crm conventions.
