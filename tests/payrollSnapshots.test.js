import { describe, it, expect } from "vitest";
import { isMissingSchemaError, periodLabel, latestSnapshot, snapshotCsv, snapshotsForEntity } from "../lib/payrollSnapshots.js";

describe("periodLabel", () => {
  it("formats a valid year/month as 'Jan 2026'", () => {
    expect(periodLabel(2026, 1)).toBe("Jan 2026");
    expect(periodLabel(2026, 12)).toBe("Dec 2026");
    expect(periodLabel(2025, 7)).toBe("Jul 2025");
  });

  it("falls back to a plain year-month string for an invalid month", () => {
    expect(periodLabel(2026, 0)).toBe("2026-0");
    expect(periodLabel(2026, 13)).toBe("2026-13");
    expect(periodLabel(2026, null)).toBe("2026-null");
  });
});

describe("latestSnapshot", () => {
  it("picks the greatest (period_year, period_month) from unordered input", () => {
    const rows = [
      { id: "a", period_year: 2025, period_month: 12 },
      { id: "b", period_year: 2026, period_month: 3 },
      { id: "c", period_year: 2026, period_month: 1 },
    ];
    expect(latestSnapshot(rows).id).toBe("b");
  });

  it("returns null for empty or nullish input", () => {
    expect(latestSnapshot([])).toBeNull();
    expect(latestSnapshot(null)).toBeNull();
    expect(latestSnapshot(undefined)).toBeNull();
  });

  it("returns the row itself for a single-row array", () => {
    const rows = [{ id: "only", period_year: 2026, period_month: 5 }];
    expect(latestSnapshot(rows)).toBe(rows[0]);
  });
});

describe("isMissingSchemaError", () => {
  it("is true for messages indicating the migration is not applied", () => {
    expect(isMissingSchemaError({ message: "Could not find the table 'public.payroll_run_snapshots' in the schema cache" })).toBe(true);
    expect(isMissingSchemaError({ message: "function public.accounts_sync_payroll_snapshots() does not exist" })).toBe(true);
    expect(isMissingSchemaError({ message: "relation does not exist" })).toBe(true);
  });

  it("is false for an unrelated error message", () => {
    expect(isMissingSchemaError({ message: "permission denied for table payroll_run_snapshots" })).toBe(false);
    expect(isMissingSchemaError({ message: "network error" })).toBe(false);
  });

  it("is safe for null/undefined input", () => {
    expect(isMissingSchemaError(null)).toBe(false);
    expect(isMissingSchemaError(undefined)).toBe(false);
    expect(isMissingSchemaError({})).toBe(false);
  });
});

describe("snapshotCsv", () => {
  const rows = [
    {
      period_year: 2026, period_month: 3, period_start: "2026-03-01", period_end: "2026-03-31",
      pay_date: "2026-04-02", currency: "NPR", employees_count: 12,
      total_gross: 500000, total_ssf_employee: 20000, total_ssf_employer: 40000,
      total_ssf_payable: 60000, total_tds: 5000, total_net: 435000, total_cash_cost: 500000,
      finalised_at: "2026-04-01T10:00:00Z", finalised_by_name: "Smith, John \"HR\"",
    },
    {
      period_year: 2026, period_month: 1, period_start: "2026-01-01", period_end: "2026-01-31",
      pay_date: null, currency: "NPR", employees_count: 10,
      total_gross: 400000, total_ssf_employee: 16000, total_ssf_employer: 32000,
      total_ssf_payable: 48000, total_tds: 4000, total_net: 348000, total_cash_cost: 400000,
      finalised_at: "2026-02-01T09:00:00Z", finalised_by_name: null,
    },
  ];

  it("has the exact expected header row", () => {
    const csv = snapshotCsv(rows);
    const header = csv.split("\n")[0];
    expect(header).toBe(
      "period,period_start,period_end,pay_date,currency,employees,total_gross,total_ssf_employee,total_ssf_employer,total_ssf_payable,total_tds,total_net,total_cash_cost,finalised_at,finalised_by"
    );
  });

  it("sorts rows oldest period first regardless of input order", () => {
    const csv = snapshotCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[1].startsWith("Jan 2026,")).toBe(true);
    expect(lines[2].startsWith("Mar 2026,")).toBe(true);
  });

  it("quotes a field containing a comma and doubles inner quotes", () => {
    const csv = snapshotCsv(rows);
    expect(csv).toContain('"Smith, John ""HR"""');
  });

  it("renders a null pay_date as an empty field", () => {
    const csv = snapshotCsv(rows);
    const janLine = csv.trim().split("\n")[1];
    // period,period_start,period_end,pay_date,... -> 4th field is pay_date
    const fields = janLine.split(",");
    expect(fields[3]).toBe("");
  });

  it("ends with a trailing newline", () => {
    const csv = snapshotCsv(rows);
    expect(csv.endsWith("\n")).toBe(true);
  });

  it("returns just the header (plus trailing newline) for an empty array", () => {
    const csv = snapshotCsv([]);
    expect(csv.split("\n")).toEqual([
      "period,period_start,period_end,pay_date,currency,employees,total_gross,total_ssf_employee,total_ssf_employer,total_ssf_payable,total_tds,total_net,total_cash_cost,finalised_at,finalised_by",
      "",
    ]);
  });
});

describe("snapshotsForEntity", () => {
  const flAu = { id: "au-uuid", code: "fl-au" };
  const flNepal = { id: "nepal-uuid", code: "fl-nepal" };

  const rows = [
    { id: "1", entity_id: "au-uuid", entity_code: "fl-au" },
    { id: "2", entity_id: "nepal-uuid", entity_code: "fl-nepal" },
    { id: "3", entity_id: null, entity_code: "fl-nepal" }, // pre entity_id-migration row
    { id: "4", entity_id: "other-uuid", entity_code: "fl-au" }, // entity_id mismatch, dropped
  ];

  it("returns rows unchanged for a null/undefined entity (All entities)", () => {
    expect(snapshotsForEntity(rows, null)).toEqual(rows);
    expect(snapshotsForEntity(rows, undefined)).toEqual(rows);
  });

  it("matches by entity_id when present", () => {
    expect(snapshotsForEntity(rows, flAu).map((r) => r.id)).toEqual(["1"]);
    expect(snapshotsForEntity(rows, flNepal).map((r) => r.id)).toEqual(["2", "3"]);
  });

  it("falls back to entity_code when entity_id is null/undefined", () => {
    const preMigrationRows = [{ id: "x", entity_id: null, entity_code: "fl-nepal" }];
    expect(snapshotsForEntity(preMigrationRows, flNepal).map((r) => r.id)).toEqual(["x"]);
    expect(snapshotsForEntity(preMigrationRows, flAu)).toEqual([]);
  });

  it("drops rows whose entity_id mismatches, even if entity_code would have matched", () => {
    expect(snapshotsForEntity(rows, flAu).map((r) => r.id)).not.toContain("4");
  });

  it("is null-safe and does not mutate the input array", () => {
    expect(snapshotsForEntity(null, flAu)).toEqual([]);
    expect(snapshotsForEntity(undefined, flAu)).toEqual([]);
    const copy = [...rows];
    snapshotsForEntity(rows, flAu);
    expect(rows).toEqual(copy);
  });
});
