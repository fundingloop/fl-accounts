"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Pencil, Trash2, Paperclip, Upload, CheckCircle2, Circle, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase-browser";
import { useFloatAccount } from "@/lib/useFloatAccount";
import { formatCurrency, formatDate, todayISO } from "@/lib/format";

const CATEGORY_SUGGESTIONS = [
  "Rent", "Utilities", "Salaries", "Software", "Bank fees", "Travel", "Insurance", "Marketing", "Office supplies", "Professional fees", "Other",
];

const RECURRENCE_OPTIONS = ["weekly", "fortnightly", "monthly", "quarterly", "annually"];

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unpaid", label: "Unpaid" },
  { id: "overdue", label: "Overdue" },
  { id: "paid", label: "Paid" },
];

const emptyForm = {
  description: "",
  category: "",
  charge_type: "one_off",
  recurrence: "",
  amount: "",
  invoice_date: "",
  due_date: "",
};

function isOverdue(bill) {
  return !bill.paid && bill.due_date && bill.due_date < todayISO();
}

export default function BillsPage() {
  const { account, loading: accountLoading } = useFloatAccount();
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null); // bill id currently mid-action (paid toggle / upload / delete)
  const fileInputs = useRef({});

  const loadBills = async (accountId) => {
    setLoading(true);
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("bills")
      .select("*")
      .eq("account_id", accountId)
      .order("due_date", { ascending: true, nullsFirst: false });
    if (err) setError(err.message);
    else setBills(data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (account?.id) loadBills(account.id);
  }, [account?.id]);

  const filtered = useMemo(() => {
    if (filter === "unpaid") return bills.filter((b) => !b.paid);
    if (filter === "overdue") return bills.filter(isOverdue);
    if (filter === "paid") return bills.filter((b) => b.paid);
    return bills;
  }, [bills, filter]);

  const total = useMemo(() => filtered.reduce((sum, b) => sum + (Number(b.amount) || 0), 0), [filtered]);
  const currency = account?.currency || "NPR";

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (bill) => {
    setEditingId(bill.id);
    setForm({
      description: bill.description || "",
      category: bill.category || "",
      charge_type: bill.charge_type || "one_off",
      recurrence: bill.recurrence || "",
      amount: bill.amount != null ? String(bill.amount) : "",
      invoice_date: bill.invoice_date || "",
      due_date: bill.due_date || "",
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const submitForm = async (e) => {
    e.preventDefault();
    if (!account?.id) return;
    setSaving(true);
    setError("");
    const supabase = createClient();

    const payload = {
      description: form.description.trim(),
      category: form.category.trim() || null,
      charge_type: form.charge_type,
      recurrence: form.charge_type === "recurring" ? form.recurrence || null : null,
      amount: Number(form.amount) || 0,
      invoice_date: form.invoice_date || null,
      due_date: form.due_date || null,
    };

    if (editingId) {
      const { error: err } = await supabase.from("bills").update(payload).eq("id", editingId);
      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: err } = await supabase.from("bills").insert({
        ...payload,
        account_id: account.id,
        created_by: user?.id || null,
      });
      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    closeForm();
    loadBills(account.id);
  };

  const togglePaid = async (bill) => {
    setBusyId(bill.id);
    const supabase = createClient();
    const nextPaid = !bill.paid;
    const { data, error: err } = await supabase
      .from("bills")
      .update({ paid: nextPaid, paid_date: nextPaid ? todayISO() : null })
      .eq("id", bill.id)
      .eq("paid", bill.paid)
      .select("id");
    if (err) setError(err.message);
    else if (!data || data.length === 0) {
      setError("This bill was changed by someone else - the list has been refreshed, please retry.");
    }
    await loadBills(account.id);
    setBusyId(null);
  };

  const deleteBill = async (bill) => {
    if (!window.confirm(`Delete "${bill.description}"? This cannot be undone.`)) return;
    setBusyId(bill.id);
    try {
      const res = await fetch("/api/bills/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bill_id: bill.id }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || "Could not delete the bill");
    } catch (err) {
      setError(err.message || "Could not delete the bill");
    }
    await loadBills(account.id);
    setBusyId(null);
  };

  const triggerUpload = (billId) => {
    fileInputs.current[billId]?.click();
  };

  const handleFileChange = async (bill, e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusyId(bill.id);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("bill_id", bill.id);
      fd.append("account_id", account.id);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      await loadBills(account.id);
    } catch (err) {
      setError(err.message || "Upload failed");
    }
    setBusyId(null);
  };

  const viewAttachment = async (bill) => {
    if (!bill.attachment_path) return;
    setBusyId(bill.id);
    try {
      const res = await fetch(`/api/download?path=${encodeURIComponent(bill.attachment_path)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not open file");
      window.open(json.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err.message || "Could not open file");
    }
    setBusyId(null);
  };

  return (
    <AppShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#012E41", margin: 0 }}>Bills</h1>
          <p style={{ fontSize: 13, color: "#6b7c85", margin: "4px 0 0" }}>Invoices, recurring charges and payment status</p>
        </div>
        <button
          onClick={openAdd}
          style={{
            display: "flex", alignItems: "center", gap: 6, background: "#2BA99F", color: "#fff", border: "none",
            borderRadius: 8, padding: "10px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <Plus size={16} /> Add bill
        </button>
      </div>

      {error && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{error}</span>
          <button onClick={() => setError("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#B91C1C" }}><X size={14} /></button>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              border: "1px solid " + (filter === f.id ? "#2BA99F" : "#e0e6e8"),
              background: filter === f.id ? "#2BA99F" : "#fff",
              color: filter === f.id ? "#fff" : "#334",
              borderRadius: 20, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Add/edit form panel */}
      {formOpen && (
        <form onSubmit={submitForm} style={{ background: "#fff", borderRadius: 12, padding: 20, marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#012E41" }}>{editingId ? "Edit bill" : "Add bill"}</div>
            <button type="button" onClick={closeForm} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a99a0" }}><X size={16} /></button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
            <Field label="Description" required>
              <input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Category">
              <input list="category-suggestions" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={inputStyle} />
              <datalist id="category-suggestions">
                {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
              </datalist>
            </Field>
            <Field label="Type">
              <select value={form.charge_type} onChange={(e) => setForm({ ...form, charge_type: e.target.value, recurrence: e.target.value === "one_off" ? "" : form.recurrence })} style={inputStyle}>
                <option value="one_off">One-off</option>
                <option value="recurring">Recurring</option>
              </select>
            </Field>
            {form.charge_type === "recurring" && (
              <Field label="Recurrence" required>
                <select required value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })} style={inputStyle}>
                  <option value="" disabled>Select...</option>
                  {RECURRENCE_OPTIONS.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
                </select>
              </Field>
            )}
            <Field label={`Amount (${currency})`} required>
              <input required type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Invoice date">
              <input type="date" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} style={inputStyle} />
            </Field>
            <Field label={form.charge_type === "recurring" ? "First due date" : "Due date"}>
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} style={inputStyle} />
            </Field>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button type="submit" disabled={saving} style={{ background: "#012E41", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>
              {saving ? "Saving..." : editingId ? "Save changes" : "Add bill"}
            </button>
            <button type="button" onClick={closeForm} style={{ background: "#f2f4f5", color: "#334", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Finance table */}
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.06)", overflow: "hidden" }}>
        {accountLoading || loading ? (
          <div style={{ padding: 24, color: "#6b7c85", fontSize: 13.5 }}>Loading bills...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, color: "#8a99a0", fontSize: 13.5 }}>No bills in this view.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f6f8f9", textAlign: "left" }}>
                  <Th>Description</Th>
                  <Th>Category</Th>
                  <Th>Type</Th>
                  <Th>Due date</Th>
                  <Th align="right">Amount</Th>
                  <Th>Status</Th>
                  <Th>Attachment</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((bill) => {
                  const overdue = isOverdue(bill);
                  const busy = busyId === bill.id;
                  return (
                    <tr key={bill.id} style={{ borderTop: "1px solid #f0f2f3" }}>
                      <Td>
                        <div style={{ fontWeight: 600, color: "#012E41" }}>{bill.description}</div>
                        {bill.charge_type === "recurring" && (
                          <div style={{ fontSize: 11, color: "#8a99a0" }}>Recurring - {bill.recurrence}</div>
                        )}
                      </Td>
                      <Td>{bill.category || "-"}</Td>
                      <Td>{bill.charge_type === "recurring" ? "Recurring" : "One-off"}</Td>
                      <Td style={overdue ? { color: "#B91C1C", fontWeight: 600 } : undefined}>{formatDate(bill.due_date)}</Td>
                      <Td align="right" style={{ fontWeight: 600 }}>{formatCurrency(bill.amount, currency)}</Td>
                      <Td>
                        <button
                          onClick={() => togglePaid(bill)}
                          disabled={busy}
                          style={{
                            display: "flex", alignItems: "center", gap: 6, border: "none", background: "none", cursor: busy ? "default" : "pointer",
                            color: bill.paid ? "#1E8B82" : overdue ? "#B91C1C" : "#B45309", fontSize: 12.5, fontWeight: 600, padding: 0, fontFamily: "inherit",
                          }}
                          title={bill.paid ? "Mark unpaid" : "Mark paid"}
                        >
                          {bill.paid ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                          {bill.paid ? "Paid" : overdue ? "Overdue" : "Unpaid"}
                        </button>
                      </Td>
                      <Td>
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          ref={(el) => (fileInputs.current[bill.id] = el)}
                          style={{ display: "none" }}
                          onChange={(e) => handleFileChange(bill, e)}
                        />
                        {bill.attachment_path ? (
                          <button onClick={() => viewAttachment(bill)} disabled={busy} style={linkBtnStyle}>
                            <Paperclip size={13} /> View
                          </button>
                        ) : (
                          <button onClick={() => triggerUpload(bill.id)} disabled={busy} style={linkBtnStyle}>
                            <Upload size={13} /> Attach
                          </button>
                        )}
                      </Td>
                      <Td align="right">
                        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                          <button onClick={() => openEdit(bill)} disabled={busy} style={iconBtnStyle} title="Edit"><Pencil size={14} /></button>
                          <button onClick={() => deleteBill(bill)} disabled={busy} style={{ ...iconBtnStyle, color: "#B91C1C" }} title="Delete"><Trash2 size={14} /></button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid #e0e6e8", background: "#f6f8f9" }}>
                  <Td style={{ fontWeight: 700, color: "#012E41" }}>Total ({filtered.length})</Td>
                  <Td /><Td /><Td />
                  <Td align="right" style={{ fontWeight: 700, color: "#012E41" }}>{formatCurrency(total, currency)}</Td>
                  <Td /><Td /><Td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
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

function Th({ children, align }) {
  return (
    <th style={{ padding: "10px 14px", fontSize: 11.5, fontWeight: 700, color: "#6b7c85", textTransform: "uppercase", letterSpacing: ".03em", textAlign: align || "left" }}>
      {children}
    </th>
  );
}

function Td({ children, align, style }) {
  return (
    <td style={{ padding: "12px 14px", textAlign: align || "left", color: "#334", ...style }}>
      {children}
    </td>
  );
}

const inputStyle = {
  width: "100%", padding: "8px 10px", border: "1px solid #d7dee1", borderRadius: 7, fontSize: 13, fontFamily: "inherit", outline: "none",
};

const linkBtnStyle = {
  display: "flex", alignItems: "center", gap: 5, border: "none", background: "none", color: "#2BA99F", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: 0, fontFamily: "inherit",
};

const iconBtnStyle = {
  border: "none", background: "none", cursor: "pointer", color: "#6b7c85", padding: 4,
};
