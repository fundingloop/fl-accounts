"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase-browser";
import { useFloatAccount } from "@/lib/useFloatAccount";
import { useEntities } from "@/lib/useEntities";
import { formatCurrency, formatDate } from "@/lib/format";
import { computePayroll, payrollTotals, EMPLOYER_SSF_RATE, TOTAL_SSF_RATE } from "@/lib/payroll";
import { isMissingSchemaError, periodLabel, snapshotCsv, snapshotsForEntity } from "@/lib/payrollSnapshots";
import { entityDisplayName } from "@/lib/entities";

const emptyForm = {
  employee_name: "",
  branch: "",
  designation: "",
  basic_salary: "",
  dearness_allowance: "",
  commission: "",
  leave_encashment: "",
  ssf_salary_advance: "",
  deduction_pf: "",
  sst: "",
  tds: "",
};

// Number fields that map straight to a payroll_employees column.
const NUM_FIELDS = [
  "basic_salary",
  "dearness_allowance",
  "commission",
  "leave_encashment",
  "ssf_salary_advance",
  "deduction_pf",
  "sst",
  "tds",
];

export default function PayrollPage() {
  const { account, loading: accountLoading } = useFloatAccount();
  const { entities, currentEntity, allSelected } = useEntities();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  // Payroll run history - finance snapshots of finalised fl-people runs.
  // Loaded independently of the float account: the history section has no
  // dependency on it, and the underlying table/RPC may not exist yet if the
  // snapshot migration hasn't been applied.
  const [snapshotRows, setSnapshotRows] = useState([]);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotSchemaMissing, setSnapshotSchemaMissing] = useState(false);
  const [snapshotError, setSnapshotError] = useState("");
  const [snapshotNote, setSnapshotNote] = useState("");

  const currency = account?.currency || "NPR";

  const load = async (accountId) => {
    setLoading(true);
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("payroll_employees")
      .select("*")
      .eq("account_id", accountId)
      .eq("active", true)
      .order("employee_name", { ascending: true });
    if (err) setError(err.message);
    else setRows(data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (account?.id) load(account.id);
  }, [account?.id]);

  // Sync + load payroll run history. Runs the sync RPC first (idempotent -
  // captures any newly finalised fl-people runs), then reads whatever rows
  // exist regardless of whether the sync itself succeeded, since reads can
  // succeed even when the sync call fails for a non-schema reason.
  const loadSnapshots = async () => {
    setSnapshotLoading(true);
    setSnapshotError("");
    setSnapshotNote("");
    const supabase = createClient();

    const { data: captured, error: syncErr } = await supabase.rpc("accounts_sync_payroll_snapshots");
    if (syncErr && isMissingSchemaError(syncErr)) {
      setSnapshotSchemaMissing(true);
      setSnapshotRows([]);
      setSnapshotLoading(false);
      return;
    }
    if (syncErr) {
      setSnapshotError(syncErr.message);
    } else if (captured > 0) {
      setSnapshotNote(`Captured ${captured} new finalised run(s).`);
    }

    const { data, error: loadErr } = await supabase
      .from("payroll_run_snapshots")
      .select("*")
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false });

    if (loadErr && isMissingSchemaError(loadErr)) {
      setSnapshotSchemaMissing(true);
      setSnapshotRows([]);
    } else if (loadErr) {
      setSnapshotError((prev) => prev || loadErr.message);
      setSnapshotRows([]);
    } else {
      setSnapshotSchemaMissing(false);
      setSnapshotRows(data || []);
    }
    setSnapshotLoading(false);
  };

  useEffect(() => {
    loadSnapshots();
  }, []);

  const downloadSnapshotCsv = () => {
    const csv = snapshotCsv(scopedSnapshotRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "payroll-run-history.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const totals = useMemo(() => payrollTotals(rows), [rows]);
  const preview = useMemo(() => computePayroll(form), [form]);

  // History rows scoped to the selected entity; in all-entities mode every
  // row is shown alongside an Entity column.
  const scopedSnapshotRows = useMemo(
    () => (allSelected ? snapshotRows : snapshotsForEntity(snapshotRows, currentEntity)),
    [snapshotRows, allSelected, currentEntity]
  );

  // entityLabelForSnapshot(row) -> display name via entity_id lookup,
  // falling back to the row's entity_code text when there is no match
  // (pre entity_id-migration rows, or a code with no registered entity).
  const entityLabelForSnapshot = (row) => {
    if (row.entity_id) {
      const match = entities.find((e) => e.id === row.entity_id);
      if (match) return entityDisplayName(match);
    }
    return row.entity_code || "-";
  };

  const openAdd = () => { setEditingId(null); setForm(emptyForm); setFormOpen(true); };
  const openEdit = (r) => {
    setEditingId(r.id);
    const f = { employee_name: r.employee_name || "", branch: r.branch || "", designation: r.designation || "" };
    for (const k of NUM_FIELDS) f[k] = r[k] != null ? String(r[k]) : "";
    setForm(f);
    setFormOpen(true);
  };
  const closeForm = () => { setFormOpen(false); setEditingId(null); setForm(emptyForm); };

  const submitForm = async (e) => {
    e.preventDefault();
    if (!account?.id) return;
    setSaving(true);
    setError("");
    const supabase = createClient();
    const payload = {
      employee_name: form.employee_name.trim(),
      branch: form.branch.trim() || null,
      designation: form.designation.trim() || null,
    };
    for (const k of NUM_FIELDS) payload[k] = Number(form[k]) || 0;
    if (editingId) {
      const { error: err } = await supabase.from("payroll_employees").update(payload).eq("id", editingId);
      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { error: err } = await supabase.from("payroll_employees").insert({
        ...payload, account_id: account.id, created_by: user?.id || null,
      });
      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    closeForm();
    load(account.id);
  };

  const deleteRow = async (r) => {
    if (!window.confirm(`Remove ${r.employee_name} from the payroll register? The record is deactivated, not deleted, so history is preserved.`)) return;
    setBusyId(r.id);
    const supabase = createClient();
    const { error: err } = await supabase.from("payroll_employees").update({ active: false }).eq("id", r.id);
    if (err) setError(err.message);
    await load(account.id);
    setBusyId(null);
  };

  return (
    <AppShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#012E41", margin: 0 }}>Payroll</h1>
          <p style={{ fontSize: 13, color: "#6b7c85", margin: "4px 0 0" }}>
            Nepal salary register - SSF contribution {Math.round(EMPLOYER_SSF_RATE * 100)}% added to income, {Math.round(TOTAL_SSF_RATE * 100)}% deducted (CIT / SSF), both on basic salary - register below is a reference/estimate; finalised history comes from fl-people payroll runs
          </p>
        </div>
        {!allSelected && (
          <button onClick={openAdd} style={{ display: "flex", alignItems: "center", gap: 6, background: "#2BA99F", color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            <Plus size={16} /> Add employee
          </button>
        )}
      </div>

      {/* Payroll run history - finance snapshots of finalised fl-people runs */}
      <div style={{ marginTop: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#012E41", margin: 0 }}>Payroll run history</h2>
            <p style={{ fontSize: 12.5, color: "#6b7c85", margin: "4px 0 0" }}>
              Immutable finance snapshots of finalised fl-people payroll runs. Figures never change once captured.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {snapshotNote && <span style={{ fontSize: 12, color: "#1E8B82", fontWeight: 600 }}>{snapshotNote}</span>}
            {!snapshotSchemaMissing && scopedSnapshotRows.length > 0 && (
              <button onClick={downloadSnapshotCsv} style={smallBtnStyle}>Download CSV</button>
            )}
            {!snapshotSchemaMissing && (
              <button onClick={loadSnapshots} disabled={snapshotLoading} style={smallBtnStyle}>Refresh</button>
            )}
          </div>
        </div>

        {snapshotSchemaMissing ? (
          <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", borderRadius: 8, padding: "10px 14px", margin: "12px 0", fontSize: 13 }}>
            Payroll run history is not live yet - the payroll snapshot migrations have not been applied to the database. The register below still works.
          </div>
        ) : (
          <>
            {snapshotError && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: 8, padding: "10px 14px", margin: "12px 0", fontSize: 13 }}>
                {snapshotError}
              </div>
            )}
            <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.06)", overflow: "hidden", margin: "12px 0" }}>
              {snapshotLoading ? (
                <div style={{ padding: 24, color: "#6b7c85", fontSize: 13.5 }}>Loading payroll run history...</div>
              ) : scopedSnapshotRows.length === 0 ? (
                <div style={{ padding: 24, color: "#8a99a0", fontSize: 13.5 }}>No finalised payroll runs have been captured yet.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, whiteSpace: "nowrap" }}>
                    <thead>
                      <tr style={{ background: "#f6f8f9", textAlign: "left" }}>
                        {allSelected && <Th>Entity</Th>}
                        <Th>Period</Th>
                        <Th>Pay date</Th>
                        <Th align="right">Employees</Th>
                        <Th align="right">Gross</Th>
                        <Th align="right">SSF employee</Th>
                        <Th align="right">SSF employer</Th>
                        <Th align="right">SSF payable</Th>
                        <Th align="right">TDS</Th>
                        <Th align="right">Net</Th>
                        <Th align="right">Cash cost</Th>
                        <Th>Finalised</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {scopedSnapshotRows.map((r) => (
                        <tr key={r.id} style={{ borderTop: "1px solid #f0f2f3" }}>
                          {allSelected && <Td>{entityLabelForSnapshot(r)}</Td>}
                          <Td style={{ fontWeight: 600, color: "#012E41" }}>{periodLabel(r.period_year, r.period_month)}</Td>
                          <Td>{formatDate(r.pay_date)}</Td>
                          <Td align="right">{r.employees_count}</Td>
                          <Td align="right">{formatCurrency(r.total_gross, r.currency)}</Td>
                          <Td align="right">{formatCurrency(r.total_ssf_employee, r.currency)}</Td>
                          <Td align="right">{formatCurrency(r.total_ssf_employer, r.currency)}</Td>
                          <Td align="right">{formatCurrency(r.total_ssf_payable, r.currency)}</Td>
                          <Td align="right">{formatCurrency(r.total_tds, r.currency)}</Td>
                          <Td align="right" style={{ fontWeight: 700, color: "#1E8B82" }}>{formatCurrency(r.total_net, r.currency)}</Td>
                          <Td align="right" style={{ fontWeight: 600 }}>{formatCurrency(r.total_cash_cost, r.currency)}</Td>
                          <Td>
                            {formatDate(r.finalised_at)}
                            {r.finalised_by_name && <div style={{ fontSize: 11, color: "#8a99a0" }}>{r.finalised_by_name}</div>}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {error && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: 8, padding: "10px 14px", margin: "14px 0", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{error}</span>
          <button onClick={() => setError("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#B91C1C" }}><X size={14} /></button>
        </div>
      )}

      {/* Add/edit form with a live payslip preview */}
      {!allSelected && formOpen && (
        <form onSubmit={submitForm} style={{ background: "#fff", borderRadius: 12, padding: 20, margin: "16px 0 20px", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#012E41" }}>{editingId ? "Edit employee" : "Add employee"}</div>
            <button type="button" onClick={closeForm} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a99a0" }}><X size={16} /></button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
            <Field label="Employee" required>
              <input required value={form.employee_name} onChange={(e) => setForm({ ...form, employee_name: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Branch">
              <input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Designation">
              <input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} style={inputStyle} />
            </Field>
            <NumField label={`Basic salary (${currency})`} required value={form.basic_salary} onChange={(v) => setForm({ ...form, basic_salary: v })} />
            <NumField label={`Dearness allowance (${currency})`} value={form.dearness_allowance} onChange={(v) => setForm({ ...form, dearness_allowance: v })} />
            <NumField label={`Commission (${currency})`} value={form.commission} onChange={(v) => setForm({ ...form, commission: v })} />
            <NumField label={`Leave encashment (${currency})`} value={form.leave_encashment} onChange={(v) => setForm({ ...form, leave_encashment: v })} />
            <NumField label={`SSF salary advance (${currency})`} value={form.ssf_salary_advance} onChange={(v) => setForm({ ...form, ssf_salary_advance: v })} />
            <NumField label={`Deduction / PF (${currency})`} value={form.deduction_pf} onChange={(v) => setForm({ ...form, deduction_pf: v })} />
            <NumField label={`SST (${currency})`} value={form.sst} onChange={(v) => setForm({ ...form, sst: v })} />
            <NumField label={`TDS (${currency})`} value={form.tds} onChange={(v) => setForm({ ...form, tds: v })} />
          </div>

          {/* Live payslip preview - income vs deductions, mirroring Rigo */}
          <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
            <PayslipColumn title="Income" accent="#1E8B82" rows={[
              ["Basic salary", preview.basic],
              ["Dearness allowance", preview.da],
              ["Commission", preview.commission],
              [`SSF contribution (${Math.round(EMPLOYER_SSF_RATE * 100)}%)`, preview.ssfContribution],
              ["Leave encashment", preview.leaveEncashment],
            ]} total={["Gross income", preview.gross]} currency={currency} />
            <PayslipColumn title="Deductions" accent="#B45309" rows={[
              ["SSF salary advance", preview.ssfSalaryAdvance],
              ["Deduction (PF)", preview.deductionPf],
              [`CIT / SSF deduction (${Math.round(TOTAL_SSF_RATE * 100)}%)`, preview.citSsf],
              ["SST", preview.sst],
              ["TDS", preview.tds],
            ]} total={["Total deduction", preview.totalDeduction]} currency={currency} />
          </div>
          <div style={{ marginTop: 12, background: "#012E41", borderRadius: 10, padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "#9fd7d0", textTransform: "uppercase", letterSpacing: ".04em" }}>Net salary</span>
            <span style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>{formatCurrency(preview.net, currency)}</span>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button type="submit" disabled={saving} style={{ background: "#012E41", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>
              {saving ? "Saving..." : editingId ? "Save changes" : "Add employee"}
            </button>
            <button type="button" onClick={closeForm} style={{ background: "#f2f4f5", color: "#334", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          </div>
        </form>
      )}

      {/* Register */}
      {allSelected ? (
        <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,.06)", marginTop: 16, color: "#8a99a0", fontSize: 13.5 }}>
          Select a specific entity to manage its payroll register.
        </div>
      ) : (
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.06)", overflow: "hidden", marginTop: 16 }}>
        {accountLoading || loading ? (
          <div style={{ padding: 24, color: "#6b7c85", fontSize: 13.5 }}>Loading payroll...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 24, color: "#8a99a0", fontSize: 13.5 }}>No employees yet. Add one to build the register.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, whiteSpace: "nowrap" }}>
              <thead>
                <tr style={{ background: "#f6f8f9", textAlign: "left" }}>
                  <Th>Employee</Th>
                  <Th>Branch</Th>
                  <Th align="right">Basic</Th>
                  <Th align="right">Dearness</Th>
                  <Th align="right">Commission</Th>
                  <Th align="right">SSF contrib.</Th>
                  <Th align="right">Leave enc.</Th>
                  <Th align="right">Gross</Th>
                  <Th align="right">SSF advance</Th>
                  <Th align="right">PF</Th>
                  <Th align="right">CIT / SSF</Th>
                  <Th align="right">SST</Th>
                  <Th align="right">TDS</Th>
                  <Th align="right">Total ded.</Th>
                  <Th align="right">Net salary</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const c = computePayroll(r);
                  const busy = busyId === r.id;
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid #f0f2f3" }}>
                      <Td>
                        <div style={{ fontWeight: 600, color: "#012E41" }}>{r.employee_name}</div>
                        {r.designation && <div style={{ fontSize: 11, color: "#8a99a0" }}>{r.designation}</div>}
                      </Td>
                      <Td>{r.branch || "-"}</Td>
                      <Td align="right">{formatCurrency(c.basic, currency)}</Td>
                      <Td align="right">{formatCurrency(c.da, currency)}</Td>
                      <Td align="right">{formatCurrency(c.commission, currency)}</Td>
                      <Td align="right" style={{ color: "#6b7c85" }}>{formatCurrency(c.ssfContribution, currency)}</Td>
                      <Td align="right">{formatCurrency(c.leaveEncashment, currency)}</Td>
                      <Td align="right" style={{ fontWeight: 600 }}>{formatCurrency(c.gross, currency)}</Td>
                      <Td align="right">{formatCurrency(c.ssfSalaryAdvance, currency)}</Td>
                      <Td align="right">{formatCurrency(c.deductionPf, currency)}</Td>
                      <Td align="right">{formatCurrency(c.citSsf, currency)}</Td>
                      <Td align="right">{formatCurrency(c.sst, currency)}</Td>
                      <Td align="right">{formatCurrency(c.tds, currency)}</Td>
                      <Td align="right">{formatCurrency(c.totalDeduction, currency)}</Td>
                      <Td align="right" style={{ fontWeight: 700, color: "#1E8B82" }}>{formatCurrency(c.net, currency)}</Td>
                      <Td align="right">
                        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                          <button onClick={() => openEdit(r)} disabled={busy} style={iconBtnStyle} title="Edit"><Pencil size={14} /></button>
                          <button onClick={() => deleteRow(r)} disabled={busy} style={{ ...iconBtnStyle, color: "#B91C1C" }} title="Remove"><Trash2 size={14} /></button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid #e0e6e8", background: "#f6f8f9" }}>
                  <Td style={{ fontWeight: 700, color: "#012E41" }}>Total ({rows.length})</Td>
                  <Td />
                  <Td align="right" style={{ fontWeight: 700 }}>{formatCurrency(totals.basic, currency)}</Td>
                  <Td align="right" style={{ fontWeight: 700 }}>{formatCurrency(totals.da, currency)}</Td>
                  <Td align="right" style={{ fontWeight: 700 }}>{formatCurrency(totals.commission, currency)}</Td>
                  <Td align="right" style={{ fontWeight: 700, color: "#6b7c85" }}>{formatCurrency(totals.ssfContribution, currency)}</Td>
                  <Td align="right" style={{ fontWeight: 700 }}>{formatCurrency(totals.leaveEncashment, currency)}</Td>
                  <Td align="right" style={{ fontWeight: 700 }}>{formatCurrency(totals.gross, currency)}</Td>
                  <Td align="right" style={{ fontWeight: 700 }}>{formatCurrency(totals.ssfSalaryAdvance, currency)}</Td>
                  <Td align="right" style={{ fontWeight: 700 }}>{formatCurrency(totals.deductionPf, currency)}</Td>
                  <Td align="right" style={{ fontWeight: 700 }}>{formatCurrency(totals.citSsf, currency)}</Td>
                  <Td align="right" style={{ fontWeight: 700 }}>{formatCurrency(totals.sst, currency)}</Td>
                  <Td align="right" style={{ fontWeight: 700 }}>{formatCurrency(totals.tds, currency)}</Td>
                  <Td align="right" style={{ fontWeight: 700 }}>{formatCurrency(totals.totalDeduction, currency)}</Td>
                  <Td align="right" style={{ fontWeight: 700, color: "#1E8B82" }}>{formatCurrency(totals.net, currency)}</Td>
                  <Td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      )}

      {!allSelected && rows.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: "#6b7c85" }}>
          Total cost to company (gross incl. employer SSF): <strong style={{ color: "#012E41" }}>{formatCurrency(totals.costToCompany, currency)}</strong> per period.
        </div>
      )}
    </AppShell>
  );
}

function Field({ label, required, children }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334", marginBottom: 5 }}>
        {label}{required && <span style={{ color: "#B91C1C" }}> *</span>}
      </span>
      {children}
    </label>
  );
}

function NumField({ label, required, value, onChange }) {
  return (
    <Field label={label} required={required}>
      <input required={required} type="number" step="0.01" min="0" value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
    </Field>
  );
}

function PayslipColumn({ title, accent, rows, total, currency }) {
  return (
    <div style={{ background: "#f6f8f9", borderRadius: 10, padding: "12px 16px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>{title}</div>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12.5, color: "#48595a" }}>
          <span>{label}</span>
          <span style={{ fontVariantNumeric: "tabular-nums", color: "#334" }}>{formatCurrency(value, currency)}</span>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid #e0e6e8", fontSize: 13, fontWeight: 700, color: "#012E41" }}>
        <span>{total[0]}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCurrency(total[1], currency)}</span>
      </div>
    </div>
  );
}

function Th({ children, align }) {
  return (
    <th style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#6b7c85", textTransform: "uppercase", letterSpacing: ".03em", textAlign: align || "left" }}>{children}</th>
  );
}

function Td({ children, align, style }) {
  return (
    <td style={{ padding: "11px 12px", textAlign: align || "left", color: "#334", ...style }}>{children}</td>
  );
}

const inputStyle = {
  width: "100%", padding: "8px 10px", border: "1px solid #d7dee1", borderRadius: 7, fontSize: 13, fontFamily: "inherit", outline: "none",
};

const iconBtnStyle = {
  border: "none", background: "none", cursor: "pointer", color: "#6b7c85", padding: 4,
};

const smallBtnStyle = {
  background: "#f2f4f5", color: "#334", border: "none", borderRadius: 7, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
