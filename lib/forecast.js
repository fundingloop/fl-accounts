// Pure, deterministic cashflow forecast util. No Supabase calls in here -
// callers fetch float_accounts / bills / float_deposits rows and pass plain
// data in. Kept dependency-free so it is easy to unit test later.
//
// Forecast logic (matches the build brief exactly):
//   currentBalance = starting_float
//     + sum(deposits with deposit_date between float_as_of_date and today)
//     - sum(paid bills whose paid_date is between float_as_of_date and today)
//
//   Project 6 months forward from today:
//     - recurring bills: generate occurrences from due_date stepping by
//       recurrence; if the anchor instance is already paid, start from the
//       next occurrence; include occurrences from today up to the horizon.
//     - unpaid one-offs: an outflow on due_date (or today if overdue).
//     - future-dated deposits: inflows on their date.
//
//   Walk events in date order from currentBalance to build a running-balance
//   series; the lowest point {balance, date} is returned for the "you dip
//   below zero" warning.

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HORIZON_MONTHS = 6;

// ---- date helpers (all UTC-midnight based so day math is exact and immune
// to local timezone offsets / DST) ----------------------------------------

function toDateOnly(value) {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  // Expect a 'YYYY-MM-DD' (Postgres date) or ISO string.
  const s = String(value).slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function addMonthsUTC(date, months) {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

// Step a date forward by one recurrence unit. Unknown/missing recurrence
// returns the same date (caller guards against infinite loops).
function stepRecurrence(date, recurrence) {
  const d = new Date(date.getTime());
  switch (recurrence) {
    case "weekly":
      return new Date(d.getTime() + 7 * DAY_MS);
    case "fortnightly":
      return new Date(d.getTime() + 14 * DAY_MS);
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + 1);
      return d;
    case "quarterly":
      d.setUTCMonth(d.getUTCMonth() + 3);
      return d;
    case "annually":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      return d;
    default:
      return d;
  }
}

// ---- currentBalance --------------------------------------------------

export function computeCurrentBalance({ startingFloat, floatAsOfDate, deposits, bills, today }) {
  const asOf = toDateOnly(floatAsOfDate);
  const todayD = toDateOnly(today || new Date());
  let balance = Number(startingFloat) || 0;

  for (const dep of deposits || []) {
    if (!dep.deposit_date) continue;
    const dd = toDateOnly(dep.deposit_date);
    if (dd >= asOf && dd <= todayD) balance += Number(dep.amount) || 0;
  }

  for (const bill of bills || []) {
    if (!bill.paid || !bill.paid_date) continue;
    const pd = toDateOnly(bill.paid_date);
    if (pd >= asOf && pd <= todayD) balance -= Number(bill.amount) || 0;
  }

  return balance;
}

// ---- future events (bills + deposits) ---------------------------------

function billEvents(bill, todayD, horizonD) {
  const events = [];
  const amount = Number(bill.amount) || 0;
  if (!amount) return events;

  if (bill.charge_type === "one_off") {
    if (bill.paid) return events; // already settled, nothing to project
    const due = bill.due_date ? toDateOnly(bill.due_date) : todayD;
    const date = due < todayD ? todayD : due; // overdue one-offs land today
    if (date <= horizonD) {
      events.push({ date, amount: -amount, kind: "bill", id: bill.id, description: bill.description });
    }
    return events;
  }

  // Recurring: v1 has a single paid flag per bill (no per-occurrence
  // payments table yet), so "paid" means the anchor due_date instance is
  // done and the next occurrence starts the projection.
  if (!bill.due_date || !bill.recurrence) return events;
  let occurrence = toDateOnly(bill.due_date);
  if (bill.paid) occurrence = stepRecurrence(occurrence, bill.recurrence);

  // Fast-forward past occurrences up to today - only occurrences from today
  // through the horizon are projected as outflows.
  let guard = 0;
  while (occurrence < todayD && guard < 2000) {
    occurrence = stepRecurrence(occurrence, bill.recurrence);
    guard++;
  }
  while (occurrence <= horizonD && guard < 4000) {
    events.push({ date: occurrence, amount: -amount, kind: "bill", id: bill.id, description: bill.description });
    occurrence = stepRecurrence(occurrence, bill.recurrence);
    guard++;
  }
  return events;
}

function depositEvents(deposit, todayD, horizonD) {
  if (!deposit.deposit_date) return [];
  const dd = toDateOnly(deposit.deposit_date);
  if (dd > todayD && dd <= horizonD) {
    return [{ date: dd, amount: Number(deposit.amount) || 0, kind: "deposit", id: deposit.id, note: deposit.note }];
  }
  return [];
}

// ---- public API ---------------------------------------------------------

// buildForecast({ startingFloat, floatAsOfDate, deposits, bills, today, horizonMonths })
// -> { currentBalance, series: [{date, balance}...], lowest: {balance, date}, events }
export function buildForecast({
  startingFloat,
  floatAsOfDate,
  deposits = [],
  bills = [],
  today,
  horizonMonths = DEFAULT_HORIZON_MONTHS,
}) {
  const todayD = toDateOnly(today || new Date());
  const horizonD = addMonthsUTC(todayD, horizonMonths);

  const currentBalance = computeCurrentBalance({ startingFloat, floatAsOfDate, deposits, bills, today: todayD });

  let events = [];
  for (const bill of bills) events = events.concat(billEvents(bill, todayD, horizonD));
  for (const dep of deposits) events = events.concat(depositEvents(dep, todayD, horizonD));
  events.sort((a, b) => a.date - b.date);

  const series = [{ date: isoDate(todayD), balance: currentBalance }];
  let running = currentBalance;
  let lowest = { balance: currentBalance, date: isoDate(todayD) };

  for (const evt of events) {
    running += evt.amount;
    const point = { date: isoDate(evt.date), balance: running };
    series.push(point);
    if (running < lowest.balance) lowest = { balance: running, date: point.date };
  }

  return { currentBalance, series, lowest, events };
}

// ---- dashboard card helpers (simple aggregates, not projections) --------

// outstanding total = sum of unpaid bill amounts (any due date)
export function outstandingTotal(bills = []) {
  return bills.reduce((sum, b) => (!b.paid ? sum + (Number(b.amount) || 0) : sum), 0);
}

// overdue = unpaid and due_date < today
export function overdueSummary(bills = [], today) {
  const todayD = toDateOnly(today || new Date());
  let count = 0;
  let amount = 0;
  for (const b of bills) {
    if (b.paid || !b.due_date) continue;
    if (toDateOnly(b.due_date) < todayD) {
      count += 1;
      amount += Number(b.amount) || 0;
    }
  }
  return { count, amount };
}

// due in the next 7 days (inclusive of today), unpaid only
export function dueSoonSummary(bills = [], today, days = 7) {
  const todayD = toDateOnly(today || new Date());
  const horizon = new Date(todayD.getTime() + days * DAY_MS);
  let count = 0;
  let amount = 0;
  for (const b of bills) {
    if (b.paid || !b.due_date) continue;
    const dd = toDateOnly(b.due_date);
    if (dd >= todayD && dd <= horizon) {
      count += 1;
      amount += Number(b.amount) || 0;
    }
  }
  return { count, amount };
}

// ---- inline sanity checks (manual reasoning, not a test runner) ---------
//
// 1) starting_float=1000, as_of=2026-01-01, today=2026-01-10, one deposit of
//    500 on 2026-01-05, one paid bill of 200 paid_date=2026-01-06:
//    currentBalance = 1000 + 500 - 200 = 1300.  computeCurrentBalance()
//    returns 1300 for that input - confirmed by tracing the loop above.
//
// 2) A recurring bill due_date=2026-06-01 recurrence='monthly', paid=false,
//    today=2026-07-06: the anchor (2026-06-01) is in the past and unpaid, so
//    the fast-forward loop steps 2026-06-01 -> 2026-07-01, but 2026-07-01 is
//    still before today, so it steps again -> 2026-08-01, which is the first
//    projected occurrence - matches "include occurrences from today up to
//    the horizon", not the stale June (or July) date.
//
// 3) Same bill but paid=true (anchor settled): occurrence starts at
//    stepRecurrence(2026-06-01, 'monthly') = 2026-07-01 before the
//    fast-forward loop runs, but that is still before today (2026-07-06), so
//    the loop steps once more -> 2026-08-01 - the same first occurrence as
//    example 2.
//
// 4) An unpaid one-off due_date=2026-05-01 (overdue vs today=2026-07-06):
//    due < todayD, so its event date is clamped to todayD (today), not the
//    stale past date - matches "on due_date (or today if overdue)".
