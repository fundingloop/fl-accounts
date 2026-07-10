# Forecast Model - fl-accounts

How the cashflow forecast is actually computed today: current balance,
6-month projection, payroll events, the per-entity dashboard summary, and the
group (all-entities) view's rules. Pure, client-side, deterministic maths in
`lib/forecast.js` and `lib/payrollForecast.js`; both are unit-tested
(`tests/forecast.test.js`, `tests/payrollForecast.test.js`) and take plain
data - no Supabase calls inside either module.

## `buildForecast()`

`lib/forecast.js` exports `buildForecast({ startingFloat, floatAsOfDate,
deposits, bills, today, horizonMonths = 6, extraEvents = [] })`, returning
`{ currentBalance, series, lowest, events }`.

**Inputs**: `deposits` and `bills` are raw rows from `float_deposits` /
`bills` for one float account. `extraEvents` is a generic hook - already
clipped to `[today, horizon]` by the caller - for projections the forecast
util itself does not know about; today the only caller is payroll (see
below), but the shape is not payroll-specific.

**Outputs**:
- `currentBalance` - see `computeCurrentBalance()` below.
- `series` - a running-balance walk: one point per event, in date order,
  starting from `{date: today, balance: currentBalance}`.
- `lowest` - the `{balance, date}` point in `series` with the smallest
  balance, for the dashboard's "dips below zero" warning.
- `events` - every projected event (bills, deposits, and anything passed via
  `extraEvents`) in date order, each `{date, amount, kind, ...}`. This is
  what `forecastSummary()` (below) aggregates - `series` is a running walk,
  not a per-kind breakdown.

## `computeCurrentBalance()`

```
currentBalance = startingFloat
  + sum(deposits with deposit_date in [floatAsOfDate, today])
  - sum(paid bills with paid_date in [floatAsOfDate, today])
```

All date comparisons are UTC-midnight based (`toDateOnly()`) so the maths is
immune to local timezone/DST drift.

## Recurrence projection

For each bill in the 6-month (default) horizon:

- **One-off, unpaid**: a single outflow on `due_date`, clamped to today if
  overdue (`due < todayD -> todayD`) so a stale past date never appears in
  the projected series.
- **One-off, paid**: no event - already settled.
- **Recurring**: v1 keeps a single `paid` flag per bill (no per-occurrence
  payments table - TECH_DEBT D3), so "paid" means the anchor `due_date`
  instance is done; the next occurrence (`stepRecurrence()`) starts the
  projection. The occurrence is then fast-forwarded past today (so a stale
  anchor months in the past does not appear), and every occurrence from
  today through the horizon is projected as an outflow.
- **Future-dated deposits**: an inflow event on each deposit's `deposit_date`,
  for dates after today and within the horizon.

## Payroll events from snapshots

The dashboard's `payroll_run_snapshots` read (never the sync RPC - only
`/payroll` calls that) is scoped to the current entity via
`snapshotsForEntity()` (`lib/payrollSnapshots.js`), then turned into
`buildForecast()`'s `extraEvents` by `payrollForecastEvents()`
(`lib/payrollForecast.js`). Two kinds of events come out of this:

- **Known liabilities from real finalised runs**: SSF payable and TDS for
  each finalised period the snapshot table already holds, at an
  AD-calendar-approximated remit date (day 15 / day 25 of the month
  following the period - configurable via `ssfRemitDay`/`tdsRemitDay`; see
  TECH_DEBT D11 for why this is an approximation of Nepal's actual
  BS-calendar statutory deadline, not a compliance calculation), plus net
  wages if the run's `pay_date` is still ahead of today.
- **Estimated future months**: beyond the latest snapshot, future months are
  extrapolated by reusing the latest snapshot's figures and its
  pay-date-to-period-end offset - a forward guess, not a real liability,
  until fl-people finalises those runs and fl-accounts captures them.

Event kinds used downstream: `bill`, `deposit`, `payroll_net`, `payroll_ssf`,
`payroll_tds`.

## `forecastSummary()`

`lib/forecast.js` also exports `forecastSummary(forecast)`, a pure
aggregation over a `buildForecast()` result's `events` array (not `series`):

| Field | Computed as |
|---|---|
| `opening` | `forecast.currentBalance`. |
| `income` | Sum of positive-amount `deposit` events. |
| `expenses` | Absolute sum of `bill` event amounts. |
| `payroll` | Absolute sum of `payroll_net` event amounts. |
| `tax` | Absolute sum of `payroll_ssf` + `payroll_tds` event amounts. |
| `closing` | `opening + sum of every event's amount (any kind, any sign)` - matches the final point of `series`. |
| `other` | Any event whose `kind` matches none of the above; still included in `closing`, but broken out separately so nothing is silently swallowed into a named bucket it doesn't belong in. |

`forecastSummary(null)` / `forecastSummary(undefined)` returns all zeros
rather than throwing. The dashboard renders this as the "6-month forecast
summary" card (opening / income / expenses / payroll / tax / closing) on the
single-entity view, and per-entity as the "Forecast closing (6mo)" figure on
each card in the group view.

## Per-entity scoping

The single-entity dashboard (`SingleEntityDashboard` in `app/page.js`)
scopes every input to the selected entity before calling `buildForecast()`:

- The float account itself comes from `useFloatAccount()`, which resolves
  the `float_accounts` row for `currentEntity.id` (falling back to the
  oldest row overall when "All entities" is selected or the entities schema
  is not yet applied - see `docs/ENTITY_MODEL.md`).
- `bills` / `float_deposits` are queried by that account's `account_id` (a
  column that predates this migration, so no schema-version branching is
  needed here).
- `payroll_run_snapshots` are read unfiltered, then scoped in JS via
  `snapshotsForEntity(rows, currentEntity)` before being turned into
  `extraEvents`.

## Group view rules (all entities)

`GroupDashboard` (`app/page.js`) loads every `float_accounts` / `bills` /
`float_deposits` / `payroll_run_snapshots` row once (`select("*")`, no
server-side entity filter - see TECH_DEBT), then for each entity in the
switcher's list:

1. Resolves that entity's float account (`entity.virtual` ? the one legacy
   row : match on `entity_id`).
2. Computes `currentCash` via `computeCurrentBalance()` and a full
   `buildForecast()` (with that entity's own scoped payroll events) to get
   `forecastSummary().closing`.
3. Renders one card per entity: current cash, forecast closing, both in that
   entity's own currency.

**Group total is a per-currency subtotal only - it never sums across
currencies.** `groupTotals` accumulates `currentCash` keyed by `row.currency`
(`totals[row.currency] = (totals[row.currency] || 0) + row.currentCash`);
the "Group total" card joins each currency's subtotal with `·`
(e.g. "A$12,400 · Rs 890,000") rather than adding them together. A footnote
states plainly: "Consolidated group total arrives with FX rates (Phase 3)."
This is a deliberate correctness constraint, not a missing feature to work
around - there is no FX rate table yet, so any cross-currency sum today would
be silently wrong.
