"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase-browser";
import { useFloatAccount } from "@/lib/useFloatAccount";
import { formatCurrency } from "@/lib/format";
import { computePayroll, payrollTotals, EMPLOYEE_SSF_RATE, EMPLOYER_SSF_RATE } from "@/lib/payroll";

const emptyForm = {
  employee_name: "",
  branch: "",
  designation: "",
  basic_salary: "",
  dearness_allowance: "",
  other_deductions: "",
};

export default function PayrollPage() {
  const { account, loading: accountLoading } = useFloatAccount();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const currency = account?.currency || "NPR";

  const load = async (accountId) => {
    setLoading(true);
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("payroll_employees")
      .select("*")
      .eq("account_id", accountId)
      .order("employee_name", { ascending: true });
    if (err) setError(err.message);
    else setRows(data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (account?.id) load(account.id);
  }, [account?.id]);

  const totals = useMemo(() => payrollTotals(rows), [rows]);
  const preview = useMemo(() => computePayroll(form), [form]);

  const openAdd = () => { setEditingId(null); setForm(emptyForm); setFormOpen(true); };
  const openEdit = (r) => {
    setEditingId(r.id);
    setForm({
      employee_name: r.employee_name || "",
      branch: r.branch || "",
      designation: r.designation || "",
      basic_salary: r.basic_salary != null ? String(r.basic_salary) : "",
      dearness_allowance: r.dearness_allowance != null ? String(r.dearness_allowance) : "",
      other_deductions: r.other_deductions != null ? String(r.other_deductions) : "",
    });
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
      basic_salary: Number(form.basic_salary) || 0,
      dearness_allowance: Number(form.dearness_allowance) || 0,
      other_deductions: Number(form.other_deductions) || 0,
    };
    if (editingId) {
      const { error: err } = await supabase.from("payroll_employees").update(payload).eq("id", editingId);
      if (err) setError(err.message);
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { error: err } = await supabase.from("payroll_employees").insert({
        ...payload, account_id: account.id, created_by: user?.id || null,
      });
      if (err) setError(err.message);
    }
    setSaving(false);
    closeForm();
    load(account.id);
  };

  const deleteRow = async (r) => {
    if (!window.confirm(`Remove ${r.employee_name} from payroll? This cannot be undone.`)) return;
    setBusyId(r.id);
    const supabase = createClient();
    const { error: err } = await supabase.from("payroll_employees").delete().eq("id", r.id);
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
            Nepal salary register - SSF employee {Math.round(EMPLOYEE_SSF_RATE * 100)}% / employer {Math.round(EMPLOYER_SSF_RATE * 100)}% of basic + dearness allowance
          </p>
        </div>
        <button onClick={openAdd} style={{ display: "flex", alignItems: "center", gap: 6, background: "#2BA99F", color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
          <Plus size={16} /> Add employee
        </button>
      </div>

      {error && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: 8, padding: "10px 14px", margin: "14px 0", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{error}</span>
          <button onClick={() => setError("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#B91C1C" }}><X size={14} /></button>
        </div>
      )}

      {/* Add/edit form with a live calculation preview */}
      {formOpen && (
        <form onSubmit={submitForm} style={{ background: "#fff", borderRadius: 12, padding: 20, margin: "16px 0 20px", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#012E41" }}>{editingId ? "Edit employee" : "Add employee"}</div>
            <button type="button" onClick={closeForm} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a99a0" }}><X size={16} /></button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14 }}>
            <Field label="Employee" required>
              <input required value={form.employee_name} onChange={(e) => setForm({ ...form, employee_name: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Branch">
              <input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Designation">
              <input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} style={inputStyle} />
            </Field>
            <Field label={`Basic salary (${currency})`} required>
              <input required type="number" step="0.01" min="0" value={form.basic_salary} onChange={(e) => setForm({ ...form, basic_salary: e.target.value })} style={inputStyle} />
            </Field>
            <Field label={`Dearness allowance (${currency})`}>
              <input type="number" step="0.01" min="0" value={form.dearness_allowance} onChange={(e) => setForm({ ...form, dearness_allowance: e.target.value })} style={inputStyle} />
            </Field>
            <Field label={`Other deductions (${currency})`}>
              <input type="number" step="0.01" min="0" value={form.other_deductions} onChange={(e) => setForm({ ...form, other_deductions: e.target.value })} style={inputStyle} />
            </Field>
          </div>

          {/* Live preview */}
          <div style={{ marginTop: 16, background: "#f6f8f9", borderRadius: 10, padding: "12px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
            <Stat label="Gross income" value={formatCurrency(preview.gross, currency)} />
            <Stat label={`Employer SSF (${Math.round(EMPLOYER_SSF_RATE * 100)}%)`} value={formatCurrency(preview.employerSsf, currency)} sub="company cost" />
            <Stat label={`SSF deduction (${Math.round(EMPLOYEE_SSF_RATE * 100)}%)`} value={formatCurrency(preview.employeeSsf, currency)} />
            <Stat label="Total deduction" value={formatCurrency(preview.totalDeduction, currency)} />
            <Stat label="Net salary" value={formatCurrency(preview.net, currency)} strong />
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
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.06)", overflow: "hidden", marginTop: 16 }}>
        {accountLoading || loading ? (
          <div style={{ padding: 24, color: "#6b7c85", fontSize: 13.5 }}>Loading payroll...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 24, color: "#8a99a0", fontSize: 13.5 }}>No employees yet. Add one to build the register.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, whiteSpace: "nowrap" }}>
              <thead>
                <tr style={{ background: "#f6f8f9", textAlign: "left" }}>
                  <Th>Employee</Th>
                  <Th>Branch</Th>
                  <Th align="right">Basic</Th>
                  <Th align="right">Dearness</Th>
                  <Th align="right">Gross</Th>
                  <Th align="right">Employer SSF</Th>
                  <Th align="right">SSF deduction</Th>
                  <Th align="right">Other deduction</Th>
                  <Th align="right">Total deduction</Th>
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
                      <Td align="right" style={{ fontWeight: 600 }}>{formatCurrency(c.gross, currency)}</Td>
                      <Td align="right" style={{ color: "#6b7c85" }}>{formatCurrency(c.employerSsf, currency)}</Td>
                      <Td align="right">{formatCurrency(c.employeeSsf, currency)}</Td>
                      <Td align="right">{formatCurrency(c.other, currency)}</Td>
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
                  <Td align="right" style={{ fontWeight: 700 }}>{formatCurrency(totals.gross, currency)}</Td>
                  <Td align="right" style={{ fontWeight: 700, color: "#6b7c85" }}>{formatCurrency(totals.employerSsf, currency)}</Td>
                  <Td align="right" style={{ fontWeight: 700 }}>{formatCurrency(totals.employeeSsf, currency)}</Td>
                  <Td align="right" style={{ fontWeight: 700 }}>{formatCurrency(totals.other, currency)}</Td>
                  <Td align="right" style={{ fontWeight: 700 }}>{formatCurrency(totals.totalDeduction, currency)}</Td>
                  <Td align="right" style={{ fontWeight: 700, color: "#1E8B82" }}>{formatCurrency(totals.net, currency)}</Td>
                  <Td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: "#6b7c85" }}>
          Total cost to company (net + all SSF): <strong style={{ color: "#012E41" }}>{formatCurrency(totals.costToCompany, currency)}</strong> per period.
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

function Stat({ label, value, sub, strong }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#6b7c85", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: strong ? 16 : 14, fontWeight: 700, color: strong ? "#1E8B82" : "#012E41", marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "#a3b0b5" }}>{sub}</div>}
    </div>
  );
}

function Th({ children, align }) {
  return (
    <th style={{ padding: "10px 14px", fontSize: 11.5, fontWeight: 700, color: "#6b7c85", textTransform: "uppercase", letterSpacing: ".03em", textAlign: align || "left" }}>{children}</th>
  );
}

function Td({ children, align, style }) {
  return (
    <td style={{ padding: "12px 14px", textAlign: align || "left", color: "#334", ...style }}>{children}</td>
  );
}

const inputStyle = {
  width: "100%", padding: "8px 10px", border: "1px solid #d7dee1", borderRadius: 7, fontSize: 13, fontFamily: "inherit", outline: "none",
};

const iconBtnStyle = {
  border: "none", background: "none", cursor: "pointer", color: "#6b7c85", padding: 4,
};
