// Nepal SSF payroll math. Pure + deterministic - callers pass plain employee
// rows in. Confirmed model (2026-07):
//   contribution base = basic_salary + dearness_allowance
//   gross income      = base
//   employer SSF      = 20% of base   (company cost, shown for info)
//   employee SSF      = 11% of base   (deducted from the employee)
//   total deduction   = employee SSF + other_deductions
//   net salary        = gross - total deduction
// Rates live here as constants - change in one place if the SSF rules change.
// All amounts are in the account currency (NPR) for v1.

export const EMPLOYEE_SSF_RATE = 0.11;
export const EMPLOYER_SSF_RATE = 0.20;

function n(v) {
  return Number(v) || 0;
}
function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

// computePayroll(employee) -> all figures for one employee's row.
export function computePayroll(emp) {
  const basic = n(emp.basic_salary);
  const da = n(emp.dearness_allowance);
  const other = n(emp.other_deductions);
  const base = basic + da;
  const gross = base;
  const employerSsf = round2(base * EMPLOYER_SSF_RATE);
  const employeeSsf = round2(base * EMPLOYEE_SSF_RATE);
  const totalDeduction = round2(employeeSsf + other);
  const net = round2(gross - totalDeduction);
  // costToCompany = gross plus the employer's SSF contribution.
  const costToCompany = round2(gross + employerSsf);
  return { basic, da, base, gross, employerSsf, employeeSsf, other, totalDeduction, net, costToCompany };
}

// payrollTotals(rows) -> summed figures across every employee (for the totals
// row). Each field is the sum of the per-employee computed values.
export function payrollTotals(rows = []) {
  const keys = ["basic", "da", "gross", "employerSsf", "employeeSsf", "other", "totalDeduction", "net", "costToCompany"];
  const t = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rows) {
    const c = computePayroll(r);
    for (const k of keys) t[k] += c[k];
  }
  for (const k of keys) t[k] = round2(t[k]);
  return t;
}

// ---- inline sanity check -------------------------------------------------
// basic=50000, DA=10000, other=0: base=60000, gross=60000,
// employerSsf=12000 (20%), employeeSsf=6600 (11%), totalDeduction=6600,
// net=53400, costToCompany=72000 - matches the confirmed payslip example.
