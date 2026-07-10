import { describe, it, expect } from "vitest";
import { computePayroll, payrollTotals } from "../lib/payroll.js";

const SUM_KEYS = [
  "basic",
  "da",
  "commission",
  "leaveEncashment",
  "ssfContribution",
  "gross",
  "ssfSalaryAdvance",
  "deductionPf",
  "citSsf",
  "sst",
  "tds",
  "totalDeduction",
  "net",
  "costToCompany",
];

function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

describe("computePayroll", () => {
  it("matches the Rigo worked example: basic 18000, DA 12000", () => {
    const result = computePayroll({ basic_salary: 18000, dearness_allowance: 12000 });
    expect(result.ssfContribution).toBe(3600);
    expect(result.gross).toBe(33600);
    expect(result.citSsf).toBe(5580);
    expect(result.totalDeduction).toBe(5580);
    expect(result.net).toBe(28020);
    expect(result.costToCompany).toBe(33600);
  });

  it("coerces string inputs the same as numeric inputs", () => {
    const numeric = computePayroll({ basic_salary: 18000, dearness_allowance: 12000 });
    const stringy = computePayroll({ basic_salary: "18000", dearness_allowance: "12000" });
    expect(stringy).toEqual(numeric);
  });

  it("treats null/undefined fields as 0", () => {
    const result = computePayroll({
      basic_salary: 5000,
      dearness_allowance: null,
      commission: undefined,
      leave_encashment: undefined,
      ssf_salary_advance: null,
      deduction_pf: undefined,
      sst: null,
      tds: undefined,
    });
    expect(result.da).toBe(0);
    expect(result.commission).toBe(0);
    expect(result.leaveEncashment).toBe(0);
    expect(result.ssfContribution).toBe(1000); // 20% of 5000
    expect(result.gross).toBe(6000);
    expect(result.citSsf).toBe(1550); // 31% of 5000
    expect(result.totalDeduction).toBe(1550);
    expect(result.net).toBe(4450);
    expect(result.costToCompany).toBe(6000);
  });

  it("extra deductions (tds) raise totalDeduction and lower net by the same amount", () => {
    const base = computePayroll({ basic_salary: 18000, dearness_allowance: 12000 });
    const withTds = computePayroll({ basic_salary: 18000, dearness_allowance: 12000, tds: 1000 });
    expect(withTds.totalDeduction).toBe(base.totalDeduction + 1000);
    expect(withTds.net).toBe(base.net - 1000);
    expect(withTds.gross).toBe(base.gross); // gross is unaffected by deductions
  });
});

describe("payrollTotals", () => {
  it("sums across employees to equal the sum of individual computePayroll results", () => {
    const rows = [
      { basic_salary: 18000, dearness_allowance: 12000 },
      { basic_salary: 5000, tds: 200 },
    ];
    const totals = payrollTotals(rows);
    const individual = rows.map((r) => computePayroll(r));

    for (const key of SUM_KEYS) {
      const expected = round2(individual.reduce((sum, r) => sum + r[key], 0));
      expect(totals[key]).toBe(expected);
    }
  });

  it("returns all zeros for an empty array", () => {
    const totals = payrollTotals([]);
    for (const key of SUM_KEYS) {
      expect(totals[key]).toBe(0);
    }
  });
});
