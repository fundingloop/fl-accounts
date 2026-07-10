// Projects payroll_run_snapshots rows (immutable finance mirrors of finalised
// fl-people payroll runs, see lib/payrollSnapshots.js) into cashflow forecast
// events. Pure, dependency-free, UTC-date-based - same conventions as
// lib/forecast.js - so this is unit-testable in isolation and its output can
// be handed to buildForecast() as `extraEvents`.
//
// Two kinds of events are produced:
//
//   1. KNOWN LIABILITIES, one pair per finalised snapshot: every finalised
//      payroll period owes two remittances the FOLLOWING month - SSF payable
//      (total_ssf_payable, falling back to total_ssf_employee +
//      total_ssf_employer if the column is missing) on day `ssfRemitDay` of
//      the month after the period, and TDS (total_tds) on day `tdsRemitDay`.
//      These day-of-month rules are a documented AD-calendar approximation of
//      Nepal statutory timing (SSF due within 15 days, TDS within 25 days of
//      month end) - not exact statutory deadlines, just a forecasting
//      convention. Each is included only if its date falls in [today,
//      horizon].
//
//      Net wages of a finalised run are normally already paid by the time the
//      run is finalised, so a net-wages event is only added when the
//      snapshot's pay_date exists AND is still >= today (a finalised-but-
//      not-yet-paid run), clipped to the horizon.
//
//   2. ESTIMATED FUTURE MONTHS: using the LATEST snapshot as a recurring
//      monthly template, every period month strictly after the latest
//      snapshot's period is projected forward (net wages, SSF, TDS) using the
//      latest snapshot's figures, for as long as any of those events land
//      within [today, horizon]. The estimated pay date for a projected month
//      reuses the latest snapshot's own (pay_date - period_end) offset in
//      days; if the latest snapshot has no pay_date, the estimated pay date
//      is just the projected month's period_end.
//
// Every event: {date, amount (negative), kind, description}. Estimated events
// say "(est.)" in the description; known-liability events do not.

import { latestSnapshot, periodLabel } from "./payrollSnapshots.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HORIZON_MONTHS = 6;
const DEFAULT_SSF_REMIT_DAY = 15;
const DEFAULT_TDS_REMIT_DAY = 25;

// ---- date helpers (mirrors lib/forecast.js conventions; duplicated rather
// than exported/shared to keep the two modules independent) ---------------

function toDateOnly(value) {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const s = String(value).slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function addMonthsUTC(date, months) {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function addDaysUTC(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

// lastDayOfPeriodMonth(year, month1based) -> UTC date of the last day of that
// calendar month. Passing the 1-based month as the (0-based) month argument
// to Date.UTC with day 0 rolls back to the last day of the intended month.
function lastDayOfPeriodMonth(year, month1based) {
  return new Date(Date.UTC(year, month1based, 0));
}

// shiftPeriod(year, month1based, n) -> {year, month} n months after the given
// period, wrapping the year correctly. n is expected to be positive here.
function shiftPeriod(year, month1based, n) {
  const total = (month1based - 1) + n;
  const newYear = year + Math.floor(total / 12);
  const newMonth = (((total % 12) + 12) % 12) + 1;
  return { year: newYear, month: newMonth };
}

function remitDate(year, month1based, day) {
  return new Date(Date.UTC(year, month1based - 1, day));
}

function inRange(date, todayD, horizonD) {
  return date >= todayD && date <= horizonD;
}

// ssfPayable(snapshot) -> total_ssf_payable, falling back to the sum of the
// employee/employer shares if the column was not selected/present.
function ssfPayable(snapshot) {
  if (snapshot.total_ssf_payable !== null && snapshot.total_ssf_payable !== undefined) {
    return Number(snapshot.total_ssf_payable) || 0;
  }
  return (Number(snapshot.total_ssf_employee) || 0) + (Number(snapshot.total_ssf_employer) || 0);
}

// ---- public API -----------------------------------------------------------

// payrollForecastEvents({ snapshots, today, horizonMonths, ssfRemitDay, tdsRemitDay })
// -> events[], sorted ascending by date, each within [today, horizon].
export function payrollForecastEvents({
  snapshots,
  today,
  horizonMonths = DEFAULT_HORIZON_MONTHS,
  ssfRemitDay = DEFAULT_SSF_REMIT_DAY,
  tdsRemitDay = DEFAULT_TDS_REMIT_DAY,
} = {}) {
  if (!snapshots || snapshots.length === 0) return [];

  const todayD = toDateOnly(today || new Date());
  const horizonD = addMonthsUTC(todayD, horizonMonths);
  const events = [];

  // 1. Known liabilities + not-yet-paid net wages, from every snapshot.
  for (const snapshot of snapshots) {
    const label = periodLabel(snapshot.period_year, snapshot.period_month);
    const next = shiftPeriod(snapshot.period_year, snapshot.period_month, 1);

    const ssfDate = remitDate(next.year, next.month, ssfRemitDay);
    if (inRange(ssfDate, todayD, horizonD)) {
      events.push({ date: ssfDate, amount: -ssfPayable(snapshot), kind: "payroll_ssf", description: `SSF remittance for ${label}` });
    }

    const tdsDate = remitDate(next.year, next.month, tdsRemitDay);
    if (inRange(tdsDate, todayD, horizonD)) {
      events.push({ date: tdsDate, amount: -(Number(snapshot.total_tds) || 0), kind: "payroll_tds", description: `TDS remittance for ${label}` });
    }

    if (snapshot.pay_date) {
      const payDate = toDateOnly(snapshot.pay_date);
      if (inRange(payDate, todayD, horizonD)) {
        events.push({ date: payDate, amount: -(Number(snapshot.total_net) || 0), kind: "payroll_net", description: `Net wages for ${label}` });
      }
    }
  }

  // 2. Estimated future months, projected from the latest snapshot.
  const latest = latestSnapshot(snapshots);
  if (latest) {
    const latestLabel = periodLabel(latest.period_year, latest.period_month);
    const latestPeriodEnd = toDateOnly(latest.period_end);
    const payDelta = latest.pay_date
      ? Math.round((toDateOnly(latest.pay_date).getTime() - latestPeriodEnd.getTime()) / DAY_MS)
      : 0;
    const estNet = Number(latest.total_net) || 0;
    const estSsf = ssfPayable(latest);
    const estTds = Number(latest.total_tds) || 0;

    // Keep projecting forward while any of the current month's events could
    // still land within the horizon; a generous buffer past horizonD covers
    // the following-month remittance and any positive pay-date delta before
    // we stop. Guarded so a pathological input can never loop forever.
    const stopAfter = addMonthsUTC(horizonD, 3);
    let offset = 1;
    let guard = 0;
    while (guard < 1000) {
      const period = shiftPeriod(latest.period_year, latest.period_month, offset);
      const periodEndEst = lastDayOfPeriodMonth(period.year, period.month);
      if (periodEndEst > stopAfter) break;

      const label = periodLabel(period.year, period.month);
      const next = shiftPeriod(period.year, period.month, 1);
      const payDateEst = addDaysUTC(periodEndEst, payDelta);

      if (inRange(payDateEst, todayD, horizonD)) {
        events.push({ date: payDateEst, amount: -estNet, kind: "payroll_net", description: `Net wages (est. from ${latestLabel} run)` });
      }

      const ssfDateEst = remitDate(next.year, next.month, ssfRemitDay);
      if (inRange(ssfDateEst, todayD, horizonD)) {
        events.push({ date: ssfDateEst, amount: -estSsf, kind: "payroll_ssf", description: `SSF remittance for ${label} (est.)` });
      }

      const tdsDateEst = remitDate(next.year, next.month, tdsRemitDay);
      if (inRange(tdsDateEst, todayD, horizonD)) {
        events.push({ date: tdsDateEst, amount: -estTds, kind: "payroll_tds", description: `TDS remittance for ${label} (est.)` });
      }

      offset += 1;
      guard += 1;
    }
  }

  events.sort((a, b) => a.date - b.date);
  return events;
}

// payrollMonthlyCashCost(snapshot) -> total_cash_cost, falling back to
// (total_net + total_ssf_employee + total_ssf_employer + total_tds) if the
// column was not selected/present. 0 for a nullish snapshot.
export function payrollMonthlyCashCost(snapshot) {
  if (!snapshot) return 0;
  if (snapshot.total_cash_cost !== null && snapshot.total_cash_cost !== undefined) {
    return Number(snapshot.total_cash_cost) || 0;
  }
  return (
    (Number(snapshot.total_net) || 0) +
    (Number(snapshot.total_ssf_employee) || 0) +
    (Number(snapshot.total_ssf_employer) || 0) +
    (Number(snapshot.total_tds) || 0)
  );
}
