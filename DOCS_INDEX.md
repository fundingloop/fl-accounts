# Documentation Index - fl-accounts

| Document | What it answers |
|---|---|
| [README.md](README.md) | What this app is, how to run it, database rules. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Current system design: auth layers, routes, RLS, storage, financial logic, operational invariants. |
| [docs/SECURITY.md](docs/SECURITY.md) | July 2026 security review: model, full ranked findings register with remediation status, standing rules for contributors. |
| [docs/FINANCIAL_SYSTEM_REVIEW.md](docs/FINANCIAL_SYSTEM_REVIEW.md) | Assessment of v1 as a finance system: capability matrix, scaling limits, ranked recommendations. |
| [docs/ARCHITECTURE_RECOMMENDATIONS.md](docs/ARCHITECTURE_RECOMMENDATIONS.md) | Target ledger-centric schema (entities, journals, payroll runs, revenue, budgets) and the additive migration path. Recommendation only - not implemented. |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Done / next / later, including the two migrations pending manual apply. |
| [docs/TECH_DEBT.md](docs/TECH_DEBT.md) | Accepted debt, why, and the trigger to revisit each item. |
| [docs/BUILD_BRIEF.md](docs/BUILD_BRIEF.md) | The original v1 build brief (historical; superseded where docs above differ). |

Related, outside this repo: `fl-crm/supabase/migrations` - the single
migration ledger for every fl-accounts table and policy.
