import { describe, it, expect } from "vitest";
import {
  computeCurrentBalance,
  buildForecast,
  outstandingTotal,
  overdueSummary,
  dueSoonSummary,
  forecastSummary,
} from "../lib/forecast.js";

describe("computeCurrentBalance", () => {
  it("starting 1000, deposit 500 in-window, paid bill 200 in-window => 1300", () => {
    const balance = computeCurrentBalance({
      startingFloat: 1000,
      floatAsOfDate: "2026-01-01",
      today: "2026-01-10",
      deposits: [{ deposit_date: "2026-01-05", amount: 500 }],
      bills: [{ paid: true, paid_date: "2026-01-06", amount: 200 }],
    });
    expect(balance).toBe(1300);
  });

  it("excludes a deposit dated before floatAsOfDate", () => {
    const balance = computeCurrentBalance({
      startingFloat: 1000,
      floatAsOfDate: "2026-01-01",
      today: "2026-01-10",
      deposits: [{ deposit_date: "2025-12-31", amount: 500 }],
      bills: [],
    });
    expect(balance).toBe(1000);
  });

  it("excludes a deposit dated after today", () => {
    const balance = computeCurrentBalance({
      startingFloat: 1000,
      floatAsOfDate: "2026-01-01",
      today: "2026-01-10",
      deposits: [{ deposit_date: "2026-01-11", amount: 500 }],
      bills: [],
    });
    expect(balance).toBe(1000);
  });

  it("ignores unpaid bills entirely", () => {
    const balance = computeCurrentBalance({
      startingFloat: 1000,
      floatAsOfDate: "2026-01-01",
      today: "2026-01-10",
      deposits: [],
      bills: [{ paid: false, paid_date: "2026-01-06", amount: 200 }],
    });
    expect(balance).toBe(1000);
  });

  it("ignores a paid bill whose paid_date falls outside the window", () => {
    const balance = computeCurrentBalance({
      startingFloat: 1000,
      floatAsOfDate: "2026-01-01",
      today: "2026-01-10",
      deposits: [],
      bills: [{ paid: true, paid_date: "2026-01-11", amount: 200 }],
    });
    expect(balance).toBe(1000);
  });
});

describe("buildForecast - one-off bills", () => {
  it("projects an unpaid one-off due in the future as a single outflow on its due date", () => {
    const { events } = buildForecast({
      startingFloat: 0,
      floatAsOfDate: "2026-07-01",
      today: "2026-07-01",
      deposits: [],
      bills: [{ id: "b1", charge_type: "one_off", paid: false, due_date: "2026-07-10", amount: 100 }],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ amount: -100, kind: "bill", id: "b1" });
    expect(events[0].date.getTime()).toBe(new Date(Date.UTC(2026, 6, 10)).getTime());
  });

  it("clamps an overdue unpaid one-off to today", () => {
    const { events } = buildForecast({
      startingFloat: 0,
      floatAsOfDate: "2026-07-01",
      today: "2026-07-06",
      deposits: [],
      bills: [{ id: "b2", charge_type: "one_off", paid: false, due_date: "2026-05-01", amount: 50 }],
    });
    expect(events).toHaveLength(1);
    expect(events[0].date.getTime()).toBe(new Date(Date.UTC(2026, 6, 6)).getTime());
  });

  it("produces no event for a paid one-off", () => {
    const { events } = buildForecast({
      startingFloat: 0,
      floatAsOfDate: "2026-07-01",
      today: "2026-07-06",
      deposits: [],
      bills: [{ id: "b3", charge_type: "one_off", paid: true, due_date: "2026-07-10", amount: 50 }],
    });
    expect(events).toHaveLength(0);
  });

  it("produces no event for a one-off due beyond the horizon", () => {
    const { events } = buildForecast({
      startingFloat: 0,
      floatAsOfDate: "2026-01-01",
      today: "2026-01-01",
      horizonMonths: 6,
      deposits: [],
      bills: [{ id: "b4", charge_type: "one_off", paid: false, due_date: "2026-08-01", amount: 50 }],
    });
    expect(events).toHaveLength(0);
  });
});

describe("buildForecast - recurring bills", () => {
  it("monthly bill due 2026-06-01, unpaid, today 2026-07-06 => first occurrence is 2026-08-01 (07-01 is skipped)", () => {
    const { events } = buildForecast({
      startingFloat: 0,
      floatAsOfDate: "2026-06-01",
      today: "2026-07-06",
      deposits: [],
      bills: [
        { id: "m1", charge_type: "recurring", paid: false, due_date: "2026-06-01", recurrence: "monthly", amount: 10 },
      ],
    });
    expect(events[0].date.getTime()).toBe(new Date(Date.UTC(2026, 7, 1)).getTime());
  });

  it("same bill with paid=true projects the identical first occurrence 2026-08-01", () => {
    const { events } = buildForecast({
      startingFloat: 0,
      floatAsOfDate: "2026-06-01",
      today: "2026-07-06",
      deposits: [],
      bills: [
        { id: "m2", charge_type: "recurring", paid: true, due_date: "2026-06-01", recurrence: "monthly", amount: 10 },
      ],
    });
    expect(events[0].date.getTime()).toBe(new Date(Date.UTC(2026, 7, 1)).getTime());
  });

  it("weekly recurring generates correctly spaced occurrences within the horizon, including one landing on today", () => {
    const { events } = buildForecast({
      startingFloat: 0,
      floatAsOfDate: "2026-07-01",
      today: "2026-07-01",
      horizonMonths: 1,
      deposits: [],
      bills: [
        { id: "w1", charge_type: "recurring", paid: false, due_date: "2026-07-01", recurrence: "weekly", amount: 5 },
      ],
    });

    // Horizon is 2026-08-01; occurrences: 07-01, 07-08, 07-15, 07-22, 07-29
    expect(events).toHaveLength(5);
    const horizon = new Date(Date.UTC(2026, 7, 1));
    for (const evt of events) {
      expect(evt.date.getTime()).toBeLessThanOrEqual(horizon.getTime());
    }
    for (let i = 1; i < events.length; i++) {
      const diffDays = (events[i].date.getTime() - events[i - 1].date.getTime()) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBe(7);
    }
    // First occurrence lands exactly on today and is included.
    expect(events[0].date.getTime()).toBe(new Date(Date.UTC(2026, 6, 1)).getTime());
  });

  it("skips recurring bills with a missing recurrence", () => {
    const { events } = buildForecast({
      startingFloat: 0,
      floatAsOfDate: "2026-07-01",
      today: "2026-07-01",
      deposits: [],
      bills: [{ id: "r1", charge_type: "recurring", paid: false, due_date: "2026-07-05", amount: 10 }],
    });
    expect(events).toHaveLength(0);
  });

  it("skips recurring bills with a missing due_date", () => {
    const { events } = buildForecast({
      startingFloat: 0,
      floatAsOfDate: "2026-07-01",
      today: "2026-07-01",
      deposits: [],
      bills: [{ id: "r2", charge_type: "recurring", paid: false, recurrence: "monthly", amount: 10 }],
    });
    expect(events).toHaveLength(0);
  });
});

describe("buildForecast - deposits", () => {
  it("includes a future-dated deposit inside the horizon as an inflow event", () => {
    const { events } = buildForecast({
      startingFloat: 0,
      floatAsOfDate: "2026-07-01",
      today: "2026-07-01",
      deposits: [{ id: "d1", deposit_date: "2026-07-15", amount: 200 }],
      bills: [],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ amount: 200, kind: "deposit", id: "d1" });
  });

  it("excludes a deposit dated today (counts only in currentBalance)", () => {
    const { events } = buildForecast({
      startingFloat: 0,
      floatAsOfDate: "2026-07-01",
      today: "2026-07-01",
      deposits: [{ id: "d2", deposit_date: "2026-07-01", amount: 200 }],
      bills: [],
    });
    expect(events).toHaveLength(0);
  });

  it("excludes a deposit dated in the past", () => {
    const { events } = buildForecast({
      startingFloat: 0,
      floatAsOfDate: "2026-06-01",
      today: "2026-07-01",
      deposits: [{ id: "d3", deposit_date: "2026-06-15", amount: 200 }],
      bills: [],
    });
    expect(events).toHaveLength(0);
  });
});

describe("buildForecast - series and lowest", () => {
  it("series[0] is today with currentBalance, and lowest tracks the minimum running point", () => {
    const { series, lowest, currentBalance } = buildForecast({
      startingFloat: 1000,
      floatAsOfDate: "2026-07-01",
      today: "2026-07-01",
      deposits: [{ id: "d1", deposit_date: "2026-07-20", amount: 100 }],
      bills: [
        { id: "b1", charge_type: "one_off", paid: false, due_date: "2026-07-10", amount: 1500 },
      ],
    });

    expect(currentBalance).toBe(1000);
    expect(series[0]).toEqual({ date: "2026-07-01", balance: 1000 });

    // Running balance accumulates in date order: bill first (-1500 => -500), then deposit (+100 => -400)
    expect(series[1]).toEqual({ date: "2026-07-10", balance: -500 });
    expect(series[2]).toEqual({ date: "2026-07-20", balance: -400 });

    expect(lowest).toEqual({ balance: -500, date: "2026-07-10" });
  });

  it("with no events, lowest equals currentBalance at today", () => {
    const { lowest, currentBalance, series } = buildForecast({
      startingFloat: 750,
      floatAsOfDate: "2026-07-01",
      today: "2026-07-01",
      deposits: [],
      bills: [],
    });
    expect(currentBalance).toBe(750);
    expect(series).toHaveLength(1);
    expect(lowest).toEqual({ balance: 750, date: "2026-07-01" });
  });
});

describe("buildForecast - extraEvents", () => {
  it("merges extraEvents into the series in date order alongside bills/deposits", () => {
    const { series, events } = buildForecast({
      startingFloat: 1000,
      floatAsOfDate: "2026-07-01",
      today: "2026-07-01",
      deposits: [{ id: "d1", deposit_date: "2026-07-20", amount: 100 }],
      bills: [{ id: "b1", charge_type: "one_off", paid: false, due_date: "2026-07-10", amount: 200 }],
      extraEvents: [
        { date: new Date(Date.UTC(2026, 6, 15)), amount: -50, kind: "payroll_ssf", description: "SSF remittance for Jun 2026" },
      ],
    });

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.kind)).toEqual(["bill", "payroll_ssf", "deposit"]);

    // Running balance: 1000 -> bill -200 (07-10) -> extra -50 (07-15) -> deposit +100 (07-20)
    expect(series[0]).toEqual({ date: "2026-07-01", balance: 1000 });
    expect(series[1]).toEqual({ date: "2026-07-10", balance: 800 });
    expect(series[2]).toEqual({ date: "2026-07-15", balance: 750 });
    expect(series[3]).toEqual({ date: "2026-07-20", balance: 850 });
  });

  it("lowest point reflects an extraEvents outflow that dips below other events", () => {
    const { lowest } = buildForecast({
      startingFloat: 100,
      floatAsOfDate: "2026-07-01",
      today: "2026-07-01",
      deposits: [],
      bills: [],
      extraEvents: [
        { date: new Date(Date.UTC(2026, 6, 5)), amount: -500, kind: "payroll_net", description: "Net wages" },
      ],
    });
    expect(lowest).toEqual({ balance: -400, date: "2026-07-05" });
  });

  it("an empty extraEvents array changes nothing versus omitting it", () => {
    const base = { startingFloat: 500, floatAsOfDate: "2026-07-01", today: "2026-07-01", deposits: [], bills: [] };
    const withoutExtra = buildForecast(base);
    const withEmptyExtra = buildForecast({ ...base, extraEvents: [] });
    expect(withEmptyExtra).toEqual(withoutExtra);
  });
});

describe("outstandingTotal / overdueSummary / dueSoonSummary", () => {
  const bills = [
    { id: "1", paid: false, due_date: "2026-07-01", amount: 100 }, // overdue vs today 2026-07-11
    { id: "2", paid: false, due_date: "2026-07-11", amount: 200 }, // due today
    { id: "3", paid: false, due_date: "2026-07-15", amount: 300 }, // due soon (within 7 days)
    { id: "4", paid: false, due_date: "2026-07-25", amount: 400 }, // future, not due soon
    { id: "5", paid: true, due_date: "2026-07-05", amount: 500 }, // paid, ignored everywhere
  ];
  const today = "2026-07-11";

  it("outstandingTotal sums all unpaid bill amounts regardless of due date", () => {
    expect(outstandingTotal(bills)).toBe(100 + 200 + 300 + 400);
  });

  it("overdueSummary counts unpaid bills with due_date strictly before today", () => {
    expect(overdueSummary(bills, today)).toEqual({ count: 1, amount: 100 });
  });

  it("dueSoonSummary counts unpaid bills due today..today+7 inclusive", () => {
    // window is 2026-07-11 .. 2026-07-18: bill 2 (07-11) and bill 3 (07-15) qualify.
    expect(dueSoonSummary(bills, today)).toEqual({ count: 2, amount: 200 + 300 });
  });
});

describe("forecastSummary", () => {
  it("buckets mixed event kinds, including an unknown kind counted into closing and other", () => {
    const forecast = buildForecast({
      startingFloat: 1000,
      floatAsOfDate: "2026-07-01",
      today: "2026-07-01",
      deposits: [{ id: "d1", deposit_date: "2026-07-05", amount: 300 }],
      bills: [{ id: "b1", charge_type: "one_off", paid: false, due_date: "2026-07-10", amount: 150 }],
      extraEvents: [
        { date: new Date(Date.UTC(2026, 6, 12)), amount: -400, kind: "payroll_net", description: "Net wages" },
        { date: new Date(Date.UTC(2026, 6, 15)), amount: -50, kind: "payroll_ssf", description: "SSF" },
        { date: new Date(Date.UTC(2026, 6, 16)), amount: -20, kind: "payroll_tds", description: "TDS" },
        { date: new Date(Date.UTC(2026, 6, 20)), amount: -75, kind: "misc_adjustment", description: "Unknown kind" },
      ],
    });

    const summary = forecastSummary(forecast);
    expect(summary.opening).toBe(1000);
    expect(summary.income).toBe(300);
    expect(summary.expenses).toBe(150);
    expect(summary.payroll).toBe(400);
    expect(summary.tax).toBe(70);
    expect(summary.other).toBe(-75);
    // closing = opening + sum of ALL event amounts (bill -150, deposit +300, payroll -400, ssf -50, tds -20, misc -75)
    expect(summary.closing).toBe(1000 - 150 + 300 - 400 - 50 - 20 - 75);
  });

  it("empty events => opening === closing, all buckets zero", () => {
    const forecast = buildForecast({
      startingFloat: 500,
      floatAsOfDate: "2026-07-01",
      today: "2026-07-01",
      deposits: [],
      bills: [],
    });
    const summary = forecastSummary(forecast);
    expect(summary.opening).toBe(500);
    expect(summary.closing).toBe(500);
    expect(summary.income).toBe(0);
    expect(summary.expenses).toBe(0);
    expect(summary.payroll).toBe(0);
    expect(summary.tax).toBe(0);
    expect(summary.other).toBe(0);
  });

  it("only positive deposit-kind amounts count toward income", () => {
    const forecast = {
      currentBalance: 100,
      events: [{ date: new Date(), amount: -30, kind: "deposit", description: "negative deposit correction" }],
    };
    const summary = forecastSummary(forecast);
    expect(summary.income).toBe(0);
    expect(summary.closing).toBe(70);
  });

  it("is safe for a null/undefined forecast", () => {
    expect(forecastSummary(null)).toEqual({ opening: 0, income: 0, expenses: 0, payroll: 0, tax: 0, closing: 0, other: 0 });
    expect(forecastSummary(undefined)).toEqual({ opening: 0, income: 0, expenses: 0, payroll: 0, tax: 0, closing: 0, other: 0 });
  });
});
