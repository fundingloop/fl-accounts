// Nepal SSF payroll math, modelled to match Rigo HR's payslip exactly.
// Pure + deterministic - callers pass plain employee rows in.
//
// CONTRIBUTION BASE = BASIC SALARY ONLY (not basic + DA). This matches Rigo:
// for basic 18,000, employer SSF = 20% = 3,600 and total SSF = 31% = 5,580.
//
// Rigo "grosses up": the employer's 20% SSF is ADDED into gross income, then
// the FULL 31% SSF (employee 11% + employer 20%) is taken back as a deduction.
// The employee's real cost nets out to their own 11%.
//
//   Income:
//     Basic Salary
//   + Dearness Allowance
//   + Commission
//   + SSF Contribution        = 20% of basic   (employer share, added here)
//   + Leave Encashment
//   = GROSS INCOME
//
//   Deductions:
//     SSF Salary Advance
//   + Deduction (PF)
//   + CIT / SSF Deduction      = 31% of basic   (full SSF, employee + employer)
//   + SST
//   + TDS
//   = TOTAL DEDUCTION
//
//   NET SALARY = GROSS INCOME - TOTAL DEDUCTION
//
// Worked example (Rigo): basic 18,000, DA 12,000 -> SSF contribution 3,600,
// gross 33,600, CIT/SSF 5,580, total deduction 5,580, net 28,020.
// All amounts are in the account currency (NPR) for v1.

export const EMPLOYEE_SSF_RATE = 0.11; // employee share (for reference)
export const EMPLOYER_SSF_RATE = 0.20; // employer share -> "SSF Contribution" income line
export const TOTAL_SSF_RATE = 0.31; // employee + employer -> "CIT / SSF Deduction"

function n(v) {
  return Number(v) || 0;
}
function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

// computePayroll(employee) -> every figure on the payslip for one employee.
export function computePayroll(emp) {
  const basic = n(emp.basic_salary);
  const da = n(emp.dearness_allowance);
  const commission = n(emp.commission);
  const leaveEncashment = n(emp.leave_encashment);

  // Income side
  const ssfContribution = round2(basic * EMPLOYER_SSF_RATE); // employer 20%, added to gross
  const gross = round2(basic + da + commission + ssfContribution + leaveEncashment);

  // Deduction side
  const ssfSalaryAdvance = n(emp.ssf_salary_advance);
  const deductionPf = n(emp.deduction_pf);
  const citSsf = round2(basic * TOTAL_SSF_RATE); // full SSF 31%
  const sst = n(emp.sst);
  const tds = n(emp.tds);
  const totalDeduction = round2(ssfSalaryAdvance + deductionPf + citSsf + sst + tds);

  const net = round2(gross - totalDeduction);
  // Cost to company = the full employer outlay, which in the grossed-up model
  // is exactly the gross income (basic + DA + commission + employer SSF + leave).
  const costToCompany = gross;

  return {
    basic,
    da,
    commission,
    leaveEncashment,
    ssfContribution,
    gross,
    ssfSalaryAdvance,
    deductionPf,
    citSsf,
    sst,
    tds,
    totalDeduction,
    net,
    costToCompany,
  };
}

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

// payrollTotals(rows) -> summed figures across every employee (totals row).
export function payrollTotals(rows = []) {
  const t = Object.fromEntries(SUM_KEYS.map((k) => [k, 0]));
  for (const r of rows) {
    const c = computePayroll(r);
    for (const k of SUM_KEYS) t[k] += c[k];
  }
  for (const k of SUM_KEYS) t[k] = round2(t[k]);
  return t;
}

// ---- inline sanity check -------------------------------------------------
// basic=18000, DA=12000, all else 0: ssfContribution=3600, gross=33600,
// citSsf=5580, totalDeduction=5580, net=28020 - matches the Rigo payslip.
