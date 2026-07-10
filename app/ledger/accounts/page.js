"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Archive, RotateCcw, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import LedgerTabs from "@/components/ledger/LedgerTabs";
import { createClient } from "@/lib/supabase-browser";
import { useEntities } from "@/lib/useEntities";
import { isMissingSchemaError } from "@/lib/payrollSnapshots";
import { entityDisplayName } from "@/lib/entities";
import { ACCOUNT_TYPES, normalBalanceForType, accountsByType } from "@/lib/ledger";

const emptyForm = {
  code: "",
  name: "",
  account_type: "asset",
  normal_balance: "debit",
  parent_id: "",
  currency: "",
  is_postable: true,
  description: "",
};

// friendlyAccountError(err) -> a plain-English message for the fin_accounts
// (entity_id, code) unique-violation; falls through to the raw DB message
// for anything else (including the guard trigger's frozen-field raises,
// which are already written to be read directly).
function friendlyAccountError(err) {
  if (!err) return "";
  const msg = err.message || "";
  if (err.code === "23505" || /duplicate key/i.test(msg)) {
    return "An account with this code already exists for this entity.";
  }
  return msg || "Could not save the account.";
}

// getGroup(grouped, type) -> the array of accounts for one account_type,
// tolerant of accountsByType() returning either a Map or a plain object.
function getGroup(grouped, type) {
  if (!grouped) return [];
  if (grouped instanceof Map) return grouped.get(type) || [];
  return grouped[type] || [];
}

export default function ChartOfAccountsPage() {
  const { currentEntity, allSelected } = useEntities();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const readOnly = allSelected;

  const load = async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();
    let query = supabase
      .from("fin_accounts")
      .select("*, entity:fin_entities(id, code, legal_name, trading_name, currency)")
      .order("code", { ascending: true });
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

  const grouped = useMemo(() => accountsByType(rows), [rows]);

  const parentOptions = useMemo(
    () => rows.filter((a) => a.entity_id === currentEntity?.id && a.id !== editingId).sort((a, b) => a.code.localeCompare(b.code)),
    [rows, currentEntity?.id, editingId]
  );

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (account) => {
    setEditingId(account.id);
    setForm({
      code: account.code || "",
      name: account.name || "",
      account_type: account.account_type || "asset",
      normal_balance: account.normal_balance || "debit",
      parent_id: account.parent_id || "",
      currency: account.currency || "",
      is_postable: account.is_postable !== false,
      description: account.description || "",
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleTypeChange = (type) => {
    setForm((f) => ({ ...f, account_type: type, normal_balance: normalBalanceForType(type) }));
  };

  const submitForm = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const supabase = createClient();

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      account_type: form.account_type,
      normal_balance: form.normal_balance,
      parent_id: form.parent_id || null,
      currency: form.currency.trim() ? form.currency.trim().toUpperCase() : null,
      is_postable: !!form.is_postable,
      description: form.description.trim() || null,
    };

    if (editingId) {
      const { error: err } = await supabase.from("fin_accounts").update(payload).eq("id", editingId);
      if (err) {
        setError(friendlyAccountError(err));
        setSaving(false);
        return;
      }
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: err } = await supabase.from("fin_accounts").insert({
        ...payload,
        entity_id: currentEntity.id,
        created_by: user?.id || null,
      });
      if (err) {
        setError(friendlyAccountError(err));
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    closeForm();
    load();
  };

  const toggleArchive = async (account) => {
    const archiving = account.status !== "archived";
    const confirmMsg = archiving
      ? `Archive ${account.code} - ${account.name}? It will be hidden from postable-account pickers; existing journal lines are preserved.`
      : `Restore ${account.code} - ${account.name} to active status?`;
    if (!window.confirm(confirmMsg)) return;

    setBusyId(account.id);
    const supabase = createClient();
    const { error: err } = await supabase
      .from("fin_accounts")
      .update({
        status: archiving ? "archived" : "active",
        archived_at: archiving ? new Date().toISOString() : null,
      })
      .eq("id", account.id);
    if (err) setError(friendlyAccountError(err));
    await load();
    setBusyId(null);
  };

  const addHint = readOnly ? "Select a single entity to add an account." : "";

  return (
    <AppShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#012E41", margin: 0 }}>Ledger</h1>
          <p style={{ fontSize: 13, color: "#6b7c85", margin: "4px 0 0" }}>Double-entry journal entries and the chart of accounts</p>
        </div>
        {!schemaMissing && (
          <button
            onClick={() => !readOnly && openAdd()}
            disabled={readOnly}
            title={addHint}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: readOnly ? "#c9d3d6" : "#2BA99F", color: "#fff", border: "none",
              borderRadius: 8, padding: "10px 16px", fontSize: 13.5, fontWeight: 600,
              cursor: readOnly ? "not-allowed" : "pointer", fontFamily: "inherit",
            }}
          >
            <Plus size={16} /> Add account
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
          The ledger migration has not been applied yet.
        </div>
      ) : (
        <>
          <LedgerTabs />

          {formOpen && (
            <form onSubmit={submitForm} style={{ background: "#fff", borderRadius: 12, padding: 20, marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#012E41" }}>{editingId ? "Edit account" : "Add account"}</div>
                <button type="button" onClick={closeForm} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a99a0" }}><X size={16} /></button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
                <Field label="Code" required hint="e.g. 1000">
                  <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Name" required>
                  <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Type" required>
                  <select required value={form.account_type} onChange={(e) => handleTypeChange(e.target.value)} style={inputStyle}>
                    {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>
                <Field label="Normal balance" required>
                  <select required value={form.normal_balance} onChange={(e) => setForm({ ...form, normal_balance: e.target.value })} style={inputStyle}>
                    <option value="debit">Debit</option>
                    <option value="credit">Credit</option>
                  </select>
                </Field>
                <Field label="Parent account" hint="optional">
                  <select value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })} style={inputStyle}>
                    <option value="">None</option>
                    {parentOptions.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </Field>
                <Field label="Currency" hint="optional, 3 letters - blank = entity default">
                  <input maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} style={inputStyle} />
                </Field>
                <Field label="Description">
                  <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={inputStyle} />
                </Field>
              </div>

              <div style={{ marginTop: 14 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334", cursor: "pointer" }}>
                  <input type="checkbox" checked={form.is_postable} onChange={(e) => setForm({ ...form, is_postable: e.target.checked })} />
                  Postable (journal lines can be posted to this account)
                </label>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                <button type="submit" disabled={saving} style={{ background: "#012E41", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>
                  {saving ? "Saving..." : editingId ? "Save changes" : "Add account"}
                </button>
                <button type="button" onClick={closeForm} style={{ background: "#f2f4f5", color: "#334", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div style={{ background: "#fff", borderRadius: 12, padding: 24, color: "#6b7c85", fontSize: 13.5, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
              Loading chart of accounts...
            </div>
          ) : rows.length === 0 ? (
            <div style={{ background: "#fff", borderRadius: 12, padding: 24, color: "#8a99a0", fontSize: 13.5, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
              No accounts yet. {readOnly ? "" : "Add one to get started."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {ACCOUNT_TYPES.map((type) => {
                const accounts = getGroup(grouped, type.value);
                if (!accounts || accounts.length === 0) return null;
                return (
                  <div key={type.value} style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.06)", overflow: "hidden" }}>
                    <div style={{ padding: "12px 16px", fontSize: 13, fontWeight: 700, color: "#012E41", background: "#f6f8f9" }}>
                      {type.label}
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                        <thead>
                          <tr style={{ textAlign: "left" }}>
                            <Th>Code</Th>
                            <Th>Name</Th>
                            <Th>Normal balance</Th>
                            <Th>Currency</Th>
                            <Th>Postable</Th>
                            <Th>Status</Th>
                            {allSelected && <Th>Entity</Th>}
                            <Th align="right">Actions</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {accounts.map((account) => {
                            const archived = account.status === "archived";
                            const busy = busyId === account.id;
                            const child = !!account.parent_id;
                            return (
                              <tr key={account.id} style={{ borderTop: "1px solid #f0f2f3", opacity: archived ? 0.6 : 1 }}>
                                <Td style={{ fontFamily: "monospace", paddingLeft: child ? 32 : 14 }}>{account.code}</Td>
                                <Td style={{ fontWeight: child ? 400 : 600, color: "#012E41" }}>{account.name}</Td>
                                <Td style={{ textTransform: "capitalize" }}>{account.normal_balance}</Td>
                                <Td>{account.currency || "Entity default"}</Td>
                                <Td>{account.is_postable ? "Yes" : "No (header)"}</Td>
                                <Td>
                                  {archived ? (
                                    <span style={{ background: "#F3F4F6", color: "#6B7280", borderRadius: 20, padding: "3px 10px", fontSize: 11.5, fontWeight: 600 }}>Archived</span>
                                  ) : (
                                    <span style={{ background: "#ECFDF5", color: "#047857", borderRadius: 20, padding: "3px 10px", fontSize: 11.5, fontWeight: 600 }}>Active</span>
                                  )}
                                </Td>
                                {allSelected && <Td>{entityDisplayName(account.entity)}</Td>}
                                <Td align="right">
                                  {!readOnly && (
                                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                                      <button onClick={() => openEdit(account)} disabled={busy} style={iconBtnStyle} title="Edit"><Pencil size={14} /></button>
                                      {archived ? (
                                        <button onClick={() => toggleArchive(account)} disabled={busy} style={{ ...iconBtnStyle, color: "#1E8B82" }} title="Restore"><RotateCcw size={14} /></button>
                                      ) : (
                                        <button onClick={() => toggleArchive(account)} disabled={busy} style={{ ...iconBtnStyle, color: "#B45309" }} title="Archive"><Archive size={14} /></button>
                                      )}
                                    </div>
                                  )}
                                </Td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
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
