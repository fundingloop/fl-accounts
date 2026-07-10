# Documentation Index - fl-accounts

| Document | What it answers |
|---|---|
| [README.md](README.md) | What this app is, how to run it, database rules. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Current system design: auth layers, routes, RLS, storage, financial logic, operational invariants. |
| [docs/ENTITY_MODEL.md](docs/ENTITY_MODEL.md) | The `fin_entities` legal entity registry: columns, frozen code join key, archive-only lifecycle, `entity_id` retrofit, entity switcher UX. Authored, not yet applied. |
| [docs/BANK_ACCOUNT_MODEL.md](docs/BANK_ACCOUNT_MODEL.md) | The `fin_bank_accounts` registry and `fin_transfers` workflow: registry-not-ledger framing, masking, transfer status machine, intercompany transfers. Authored, not yet applied. |
| [docs/LEDGER_ARCHITECTURE.md](docs/LEDGER_ARCHITECTURE.md) | The ledger spine: `fin_accounts`/`fin_journals`/`fin_journal_lines`, draft-vs-posted lifecycle, derived "reversed" state, journal numbering, the four enforcement layers, entity isolation, what future modules will do. Authored, not yet applied. |
| [docs/CHART_OF_ACCOUNTS.md](docs/CHART_OF_ACCOUNTS.md) | The `fin_accounts` chart of accounts: column reference, account types, contra accounts, same-entity parent, postable vs header, archive lifecycle, frozen fields, the seeded starter chart, the `/ledger/accounts` UI. Authored, not yet applied. |
| [docs/POSTING_ENGINE.md](docs/POSTING_ENGINE.md) | `fin_post_journal`/`fin_reverse_journal`: contracts, validation order, the actor re-verification, service-role-only grants, the two API routes, the reversal relaxation, gapless numbering, the honest-failure contract, what a future module must do to post. Authored, not yet applied. |
| [docs/FORECAST_MODEL.md](docs/FORECAST_MODEL.md) | How the cashflow forecast is computed: `buildForecast`, `forecastSummary`, payroll events, per-entity scoping, group view per-currency rules. |
| [docs/SECURITY.md](docs/SECURITY.md) | July 2026 security review: model, full ranked findings register with remediation status, standing rules for contributors. |
| [docs/FINANCIAL_SYSTEM_REVIEW.md](docs/FINANCIAL_SYSTEM_REVIEW.md) | Assessment of v1 as a finance system: capability matrix, scaling limits, ranked recommendations. |
| [docs/ARCHITECTURE_RECOMMENDATIONS.md](docs/ARCHITECTURE_RECOMMENDATIONS.md) | Target ledger-centric schema (entities, journals, payroll runs, revenue, budgets) and the additive migration path. Recommendation only - not implemented. |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Done / next / later. The July 2026 security/integrity migrations are applied - milestone closed; CI live; baseline tagged `accounts-platform-v1`. Payroll split-ownership decision + snapshot mirror shipped and applied 2026-07-11 (post-apply verification passed); live end-to-end verification at accounts.fundingloop.au still outstanding. |
| [docs/TECH_DEBT.md](docs/TECH_DEBT.md) | Accepted debt, why, and the trigger to revisit each item. |
| [docs/BUILD_BRIEF.md](docs/BUILD_BRIEF.md) | The original v1 build brief (historical; superseded where docs above differ). |

Related, outside this repo: `fl-crm/supabase/migrations` - the single
migration ledger for every fl-accounts table and policy.
