import { describe, it, expect } from "vitest";
import { payrollForecastEvents, payrollMonthlyCashCost } from "../lib/payrollForecast.js";

const juneSnapshot = {
  period_year: 2026,
  period_month: 6,
  period_start: "2026-06-01",
  period_end: "2026-06-30",
  pay_date: "2026-07-02", // already paid before "today" in most tests below
  total_ssf_employee: 20000,
  total_ssf_employer: 40000,
  total_ssf_payable: 60000,
  total_tds: 5000,
  total_net: 435000,
  total_cash_cost: 500000,
};

describe("payrollForecastEvents - empty input", () => {
  it("returns [] for empty, null, and undefined snapshots", () => {
    expect(payrollForecastEvents({ snapshots: [], today: "2026-07-11" })).toEqual([]);
    expect(payrollForecastEvents({ snapshots: null, today: "2026-07-11" })).toEqual([]);
    expect(payrollForecastEvents({ snapshots: undefined, today: "2026-07-11" })).toEqual([]);
  });
});

describe("payrollForecastEvents - known liabilities from a finalised snapshot", () => {
  it("includes SSF (07-15) and TDS (07-25) for a June 2026 run, excludes net wages already paid", () => {
    const events = payrollForecastEvents({ snapshots: [juneSnapshot], today: "2026-07-11" });

    const ssf = events.find((e) => e.kind === "payroll_ssf");
    expect(ssf).toBeTruthy();
    expect(ssf.date.getTime()).toBe(new Date(Date.UTC(2026, 6, 15)).getTime());
    expect(ssf.amount).toBe(-60000);
    expect(ssf.description).toBe("SSF remittance for Jun 2026");

    const tds = events.find((e) => e.kind === "payroll_tds");
    expect(tds).toBeTruthy();
    expect(tds.date.getTime()).toBe(new Date(Date.UTC(2026, 6, 25)).getTime());
    expect(tds.amount).toBe(-5000);
    expect(tds.description).toBe("TDS remittance for Jun 2026");

    // pay_date 2026-07-02 is before today (2026-07-11) - net wages already paid.
    const knownNet = events.find((e) => e.kind === "payroll_net" && e.description === "Net wages for Jun 2026");
    expect(knownNet).toBeUndefined();
  });

  it("includes net wages when pay_date is still in the future", () => {
    const snapshot = { ...juneSnapshot, pay_date: "2026-07-20" };
    const events = payrollForecastEvents({ snapshots: [snapshot], today: "2026-07-11" });
    const net = events.find((e) => e.kind === "payroll_net");
    expect(net).toBeTruthy();
    expect(net.date.getTime()).toBe(new Date(Date.UTC(2026, 6, 20)).getTime());
    expect(net.amount).toBe(-435000);
    expect(net.description).toBe("Net wages for Jun 2026");
  });

  it("falls back to ssf_employee + ssf_employer when total_ssf_payable is missing", () => {
    const snapshot = { ...juneSnapshot, total_ssf_payable: undefined };
    const events = payrollForecastEvents({ snapshots: [snapshot], today: "2026-07-11" });
    const ssf = events.find((e) => e.kind === "payroll_ssf");
    expect(ssf.amount).toBe(-60000);
  });

  it("respects custom ssfRemitDay / tdsRemitDay", () => {
    const events = payrollForecastEvents({
      snapshots: [juneSnapshot],
      today: "2026-07-01",
      ssfRemitDay: 10,
      tdsRemitDay: 20,
    });
    const ssf = events.find((e) => e.kind === "payroll_ssf");
    const tds = events.find((e) => e.kind === "payroll_tds");
    expect(ssf.date.getTime()).toBe(new Date(Date.UTC(2026, 6, 10)).getTime());
    expect(tds.date.getTime()).toBe(new Date(Date.UTC(2026, 6, 20)).getTime());
  });

  it("clips known liabilities to the horizon", () => {
    // Horizon of 0 months from 2026-07-11 is 2026-07-11 itself - both the
    // 07-15 SSF and 07-25 TDS remittances fall outside it.
    const events = payrollForecastEvents({ snapshots: [juneSnapshot], today: "2026-07-11", horizonMonths: 0 });
    expect(events.filter((e) => e.kind === "payroll_ssf" || e.kind === "payroll_tds")).toHaveLength(0);
  });
});

describe("payrollForecastEvents - estimated future months", () => {
  it("projects the month strictly after the latest period, with pay_date == period_end reused as last-day-of-month", () => {
    const snapshot = { ...juneSnapshot, pay_date: "2026-06-30" }; // pay_date == period_end => payDelta 0
    const events = payrollForecastEvents({ snapshots: [snapshot], today: "2026-07-11", horizonMonths: 6 });

    const estNet = events.find((e) => e.kind === "payroll_net" && e.description.includes("est."));
    expect(estNet).toBeTruthy();
    expect(estNet.date.getTime()).toBe(new Date(Date.UTC(2026, 6, 31)).getTime()); // last day of July
    expect(estNet.amount).toBe(-435000);
    expect(estNet.description).toBe("Net wages (est. from Jun 2026 run)");

    const estSsf = events.find((e) => e.kind === "payroll_ssf" && e.description.includes("est."));
    expect(estSsf.date.getTime()).toBe(new Date(Date.UTC(2026, 7, 15)).getTime()); // Aug 15
    expect(estSsf.description).toBe("SSF remittance for Jul 2026 (est.)");

    const estTds = events.find((e) => e.kind === "payroll_tds" && e.description.includes("est."));
    expect(estTds.date.getTime()).toBe(new Date(Date.UTC(2026, 7, 25)).getTime()); // Aug 25
    expect(estTds.description).toBe("TDS remittance for Jul 2026 (est.)");
  });

  it("offsets the estimated pay date by the latest snapshot's own pay_date - period_end delta", () => {
    const snapshot = { ...juneSnapshot, pay_date: "2026-07-02" }; // 2 days after 2026-06-30
    const events = payrollForecastEvents({ snapshots: [snapshot], today: "2026-07-11", horizonMonths: 6 });
    const estNet = events.find((e) => e.kind === "payroll_net" && e.description.includes("est."));
    // last day of July (2026-07-31) + 2 days => 2026-08-02
    expect(estNet.date.getTime()).toBe(new Date(Date.UTC(2026, 7, 2)).getTime());
  });

  it("does not duplicate the latest snapshot's own period as an estimated month", () => {
    const events = payrollForecastEvents({ snapshots: [juneSnapshot], today: "2026-07-01", horizonMonths: 6 });
    // Estimated SSF/TDS events name the period they cover in their
    // description ("SSF remittance for <period> (est.)") - the latest
    // snapshot's own period (Jun 2026) must never appear there, since that
    // period is already covered by the known-liability pass, not estimated.
    const ssfTdsEstimates = events.filter((e) => (e.kind === "payroll_ssf" || e.kind === "payroll_tds") && e.description.includes("(est.)"));
    expect(ssfTdsEstimates.some((e) => e.description.includes("Jun 2026"))).toBe(false);
    // The first estimated period projected is the month strictly after Jun 2026.
    expect(ssfTdsEstimates.some((e) => e.description.includes("Jul 2026"))).toBe(true);
  });

  it("clips estimated months beyond the horizon", () => {
    const snapshot = { ...juneSnapshot, pay_date: "2026-06-30" };
    const events = payrollForecastEvents({ snapshots: [snapshot], today: "2026-07-11", horizonMonths: 1 });
    const horizonD = new Date(Date.UTC(2026, 7, 11)); // 2026-08-11

    // No event ever falls past the horizon.
    for (const e of events) {
      expect(e.date.getTime()).toBeLessThanOrEqual(horizonD.getTime());
    }

    // The estimated July net wages (07-31) still land inside the horizon,
    // but July's own SSF/TDS remittances (due in August, on the 15th/25th)
    // fall past it and are excluded.
    const estNet = events.find((e) => e.kind === "payroll_net" && e.description.includes("est."));
    expect(estNet).toBeTruthy();
    expect(estNet.date.getTime()).toBe(new Date(Date.UTC(2026, 6, 31)).getTime());
    expect(events.some((e) => e.kind === "payroll_ssf" && e.description.includes("est."))).toBe(false);
    expect(events.some((e) => e.kind === "payroll_tds" && e.description.includes("est."))).toBe(false);
  });

  it("projects multiple months forward when the horizon is wide enough", () => {
    const snapshot = { ...juneSnapshot, pay_date: "2026-06-30" };
    const events = payrollForecastEvents({ snapshots: [snapshot], today: "2026-07-11", horizonMonths: 6 });
    const estNetEvents = events.filter((e) => e.kind === "payroll_net" && e.description.includes("est."));
    // July, Aug, Sep, Oct, Nov, Dec, Jan (period end <= 2027-01-11-ish window)
    expect(estNetEvents.length).toBeGreaterThanOrEqual(5);
  });
});

describe("payrollForecastEvents - ordering", () => {
  it("returns events sorted ascending by date across known + estimated events", () => {
    const events = payrollForecastEvents({ snapshots: [{ ...juneSnapshot, pay_date: "2026-06-30" }], today: "2026-07-11", horizonMonths: 6 });
    for (let i = 1; i < events.length; i++) {
      expect(events[i].date.getTime()).toBeGreaterThanOrEqual(events[i - 1].date.getTime());
    }
  });
});

describe("payrollMonthlyCashCost", () => {
  it("uses total_cash_cost when present", () => {
    expect(payrollMonthlyCashCost(juneSnapshot)).toBe(500000);
  });

  it("falls back to net + ssf_employee + ssf_employer + tds when total_cash_cost is missing", () => {
    const snapshot = { ...juneSnapshot, total_cash_cost: undefined };
    expect(payrollMonthlyCashCost(snapshot)).toBe(435000 + 20000 + 40000 + 5000);
  });

  it("returns 0 for a nullish snapshot", () => {
    expect(payrollMonthlyCashCost(null)).toBe(0);
    expect(payrollMonthlyCashCost(undefined)).toBe(0);
  });
});
