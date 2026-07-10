"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, XCircle, Star, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase-browser";
import { useEntities } from "@/lib/useEntities";
import { isMissingSchemaError } from "@/lib/payrollSnapshots";
import { entityDisplayName, maskAccountNumber } from "@/lib/entities";
import { bankAccountTypeLabel } from "@/lib/banking";
import { formatCurrency, formatDate, todayISO } from "@/lib/format";

const ACCOUNT_TYPES = ["operating", "payroll", "savings", "loan", "credit_card", "other"];
const STATUS_OPTIONS = ["active", "inactive", "closed"];

const STATUS_STYLES = {
  active: { bg: "#ECFDF5", color: "#047857" },
  inactive: { bg: "#FFFBEB", color: "#92400E" },
  closed: { bg: "#F3F4F6", color: "#6B7280" },
};

const emptyForm = {
  entity_id: "",
  entity_label: "",
  bank_name: "",
  account_name: "",
  nickname: "",
  bsb: "",
  account_number: "",
  currency: "",
  account_type: "operating",
  is_primary: false,
  opening_balance: "0",
  opening_balance_date: todayISO(),
  current_balance: "0",
  balance_as_of: "",
  status: "active",
  notes: "",
};

// friendlyBankAccountError(err) -> a plain-English message for the fin_bank_accounts
// "at most one primary account per entity" partial unique index violation;
// falls through to the raw DB message for anything else.
function friendlyBankAccountError(err) {
  if (!err) return "";
  const msg = err.message || "";
  if (err.code === "23505" || /uq_fin_bank_accounts_primary/i.test(msg) || /duplicate key/i.test(msg)) {
    return "Only one primary account is allowed per entity. Unset the current primary account first, then try again.";
  }
  return msg || "Could not save the bank account.";
}

export default function BankingPage() {
  const { entities, currentEntity, allSelected } = useEntities();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();
    let query = supabase
      .from("fin_bank_accounts")
      .select("*, entity:fin_entities(id, code, legal_name, trading_name, currency)")
      .order("bank_name", { ascending: true });
    if (!allSelected && currentEntity?.id) {
      query = query.eq("entity_id", currentEntity.id);
    }
    const { data, error: err } = await query;

    if (err && isMissingSchemaError(err)) {
      setSchemaMissing(true);
      setRows([]);
      setLoading(false);
      return;
    }
    if (err) {
      setError(err.message);
      setRows([]);
      setLoading(false);
      return;
    }
    setSchemaMissing(false);
    setRows(data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSelected, currentEntity?.id]);

  const showEntityColumn = allSelected;

  const openAdd = () => {
    setEditingId(null);
    const defaultEntityId = !allSelected && currentEntity?.id ? currentEntity.id : entities[0]?.id || "";
    const defaultEntity = entities.find((e) => e.id === defaultEntityId);
    setForm({
      ...emptyForm,
      entity_id: defaultEntityId,
      currency: defaultEntity?.currency || "",
      opening_balance_date: todayISO(),
    });
    setFormOpen(true);
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setForm({
      entity_id: row.entity_id,
      entity_label: entityDisplayName(row.entity),
      bank_name: row.bank_name || "",
      account_name: row.account_name || "",
      nickname: row.nickname || "",
      bsb: row.bsb || "",
      account_number: row.account_number || "",
      currency: row.currency || "",
      account_type: row.account_type || "operating",
      is_primary: !!row.is_primary,
      opening_balance: row.opening_balance != null ? String(row.opening_balance) : "0",
      opening_balance_date: row.opening_balance_date || todayISO(),
      current_balance: row.current_balance != null ? String(row.current_balance) : "0",
      balance_as_of: row.balance_as_of || "",
      status: row.status || "active",
      notes: row.notes || "",
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleEntityChange = (id) => {
    const ent = entities.find((e) => e.id === id);
    setForm((f) => ({ ...f, entity_id: id, currency: ent?.currency || f.currency }));
  };

  const submitForm = async (e) => {
    e.preventDefault();
    if (!editingId && !form.entity_id) {
      setError("Select an entity for this bank account.");
      return;
    }
    setSaving(true);
    setError("");
    const supabase = createClient();

    const payload = {
      bank_name: form.bank_name.trim(),
      account_name: form.account_name.trim(),
      nickname: form.nickname.trim() || null,
      bsb: form.bsb.trim() || null,
      account_number: form.account_number.trim() || null,
      currency: form.currency.trim().toUpperCase(),
      account_type: form.account_type,
      is_primary: !!form.is_primary,
      opening_balance: Number(form.opening_balance) || 0,
      opening_balance_date: form.opening_balance_date || todayISO(),
      current_balance: Number(form.current_balance) || 0,
      balance_as_of: form.balance_as_of || null,
      status: form.status,
      notes: form.notes.trim() || null,
    };

    if (editingId) {
      const { error: err } = await supabase.from("fin_bank_accounts").update(payload).eq("id", editingId);
      if (err) {
        setError(friendlyBankAccountError(err));
        setSaving(false);
        return;
      }
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: err } = await supabase.from("fin_bank_accounts").insert({
        ...payload,
        entity_id: form.entity_id,
        created_by: user?.id || null,
      });
      if (err) {
        setError(friendlyBankAccountError(err));
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    closeForm();
    load();
  };

  const closeAccount = async (row) => {
    if (!window.confirm(`Close ${row.account_name}? It will be marked closed but the record is preserved, not deleted.`)) return;
    setBusyId(row.id);
    const supabase = createClient();
    const { error: err } = await supabase.from("fin_bank_accounts").update({ status: "closed" }).eq("id", row.id);
    if (err) setError(err.message);
    await load();
    setBusyId(null);
  };

  return (
    <AppShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#012E41", margin: 0 }}>Banking</h1>
          <p style={{ fontSize: 13, color: "#6b7c85", margin: "4px 0 0" }}>Bank account registry across all entities</p>
        </div>
        {!schemaMissing && (
          <button
            onClick={openAdd}
            style={{
              display: "flex", alignItems: "center", gap: 6, background: "#2BA99F", color: "#fff", border: "none",
              borderRadius: 8, padding: "10px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <Plus size={16} /> Add bank account
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{error}</span>
          <button onClick={() => setError("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#B91C1C" }}><X size={14} /></button>
        </div>
      )}

      {schemaMissing ? (
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
          The bank account registry migration has not been applied yet.
        </div>
      ) : (
        <>
          {formOpen && (
            <form onSubmit={submitForm} style={{ background: "#fff", borderRadius: 12, padding: 20, marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#012E41" }}>{editingId ? "Edit bank account" : "Add bank account"}</div>
                <button type="button" onClick={closeForm} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a99a0" }}><X size={16} /></button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
                {editingId ? (
                  <Field label="Entity" hint="frozen - cannot move between entities">
                    <input disabled value={form.entity_label} style={{ ...inputStyle, background: "#f2f4f5", color: "#8a99a0" }} />
                  </Field>
                ) : (
                  <Field label="Entity" required>
                    <select required value={form.entity_id} onChange={(e) => handleEntityChange(e.target.value)} style={inputStyle}>
                      <option value="" disabled>Select...</option>
                      {entities.map((ent) => <option key={ent.id} value={ent.id}>{entityDisplayName(ent)}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Bank / institution" required>
                  <input required value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Account name" required>
                  <input required value={form.account_name} onChange={(e) => setForm({ ...form, account_name: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Nickname">
                  <input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="BSB" hint="AU only, e.g. 123-456">
                  <input value={form.bsb} onChange={(e) => setForm({ ...form, bsb: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Account number">
                  <input value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Currency" required hint="3 letters, e.g. AUD">
                  <input required maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} style={inputStyle} />
                </Field>
                <Field label="Type" required>
                  <select required value={form.account_type} onChange={(e) => setForm({ ...form, account_type: e.target.value })} style={inputStyle}>
                    {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{bankAccountTypeLabel(t)}</option>)}
                  </select>
                </Field>
                <Field label="Status" required>
                  <select required value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} style={inputStyle}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </Field>
                <Field label={`Opening balance (${form.currency || "..."})`}>
                  <input type="number" step="0.01" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Opening balance date">
                  <input type="date" value={form.opening_balance_date} onChange={(e) => setForm({ ...form, opening_balance_date: e.target.value })} style={inputStyle} />
                </Field>
                <Field label={`Current balance (${form.currency || "..."})`}>
                  <input type="number" step="0.01" value={form.current_balance} onChange={(e) => setForm({ ...form, current_balance: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Balance as of">
                  <input type="date" value={form.balance_as_of} onChange={(e) => setForm({ ...form, balance_as_of: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Notes">
                  <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={inputStyle} />
                </Field>
              </div>

              <div style={{ marginTop: 14 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334", cursor: "pointer" }}>
                  <input type="checkbox" checked={form.is_primary} onChange={(e) => setForm({ ...form, is_primary: e.target.checked })} />
                  Set as the primary account for this entity
                </label>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                <button type="submit" disabled={saving} style={{ background: "#012E41", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>
                  {saving ? "Saving..." : editingId ? "Save changes" : "Add bank account"}
                </button>
                <button type="button" onClick={closeForm} style={{ background: "#f2f4f5", color: "#334", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.06)", overflow: "hidden" }}>
            {loading ? (
              <div style={{ padding: 24, color: "#6b7c85", fontSize: 13.5 }}>Loading bank accounts...</div>
            ) : rows.length === 0 ? (
              <div style={{ padding: 24, color: "#8a99a0", fontSize: 13.5 }}>No bank accounts yet. Add one to get started.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, whiteSpace: "nowrap" }}>
                  <thead>
                    <tr style={{ background: "#f6f8f9", textAlign: "left" }}>
                      <Th>Institution</Th>
                      <Th>Account</Th>
                      <Th>BSB</Th>
                      <Th>Number</Th>
                      <Th>Type</Th>
                      <Th>Currency</Th>
                      <Th align="right">Available balance</Th>
                      <Th align="right">Forecast balance</Th>
                      <Th>Primary</Th>
                      <Th>Status</Th>
                      <Th>Last reconciliation</Th>
                      {showEntityColumn && <Th>Entity</Th>}
                      <Th align="right">Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const busy = busyId === row.id;
                      const statusStyle = STATUS_STYLES[row.status] || STATUS_STYLES.active;
                      return (
                        <tr key={row.id} style={{ borderTop: "1px solid #f0f2f3" }}>
                          <Td style={{ fontWeight: 600, color: "#012E41" }}>{row.bank_name}</Td>
                          <Td>
                            {row.account_name}
                            {row.nickname && <div style={{ fontSize: 11, color: "#8a99a0" }}>{row.nickname}</div>}
                          </Td>
                          <Td>{row.bsb || "-"}</Td>
                          <Td style={{ fontFamily: "monospace" }}>{maskAccountNumber(row.account_number)}</Td>
                          <Td>
                            <span style={{ background: "#EFF6FF", color: "#1D4ED8", borderRadius: 20, padding: "3px 10px", fontSize: 11.5, fontWeight: 600 }}>
                              {bankAccountTypeLabel(row.account_type)}
                            </span>
                          </Td>
                          <Td>{row.currency}</Td>
                          <Td align="right">
                            <div style={{ fontWeight: 600 }}>{formatCurrency(row.current_balance, row.currency)}</div>
                            {row.balance_as_of && <div style={{ fontSize: 11, color: "#8a99a0" }}>as of {formatDate(row.balance_as_of)}</div>}
                          </Td>
                          <Td align="right" style={{ color: "#b7c1c5" }}>-</Td>
                          <Td>
                            {row.is_primary && (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#B45309", fontWeight: 600, fontSize: 12 }}>
                                <Star size={13} fill="#B45309" /> Primary
                              </span>
                            )}
                          </Td>
                          <Td>
                            <span style={{ background: statusStyle.bg, color: statusStyle.color, borderRadius: 20, padding: "3px 10px", fontSize: 11.5, fontWeight: 600, textTransform: "capitalize" }}>
                              {row.status}
                            </span>
                          </Td>
                          <Td>{row.last_reconciled_at ? formatDate(row.last_reconciled_at) : <span style={{ color: "#8a99a0" }}>Never reconciled</span>}</Td>
                          {showEntityColumn && <Td>{entityDisplayName(row.entity)}</Td>}
                          <Td align="right">
                            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                              <button onClick={() => openEdit(row)} disabled={busy} style={iconBtnStyle} title="Edit"><Pencil size={14} /></button>
                              {row.status !== "closed" && (
                                <button onClick={() => closeAccount(row)} disabled={busy} style={{ ...iconBtnStyle, color: "#B91C1C" }} title="Close"><XCircle size={14} /></button>
                              )}
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {rows.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#8a99a0" }}>
              Forecast balance arrives with ledger integration (Phase 3).
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

function Field({ label, required, hint, children }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334", marginBottom: 5 }}>
        {label}{required && <span style={{ color: "#B91C1C" }}> *</span>}
      </span>
      {children}
      {hint && <span style={{ display: "block", fontSize: 11, color: "#8a99a0", marginTop: 3 }}>{hint}</span>}
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

const iconBtnStyle = {
  border: "none", background: "none", cursor: "pointer", color: "#6b7c85", padding: 4,
};
