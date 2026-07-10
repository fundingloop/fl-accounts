"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Archive, RotateCcw, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase-browser";
import { useEntities } from "@/lib/useEntities";
import { isMissingSchemaError } from "@/lib/payrollSnapshots";
import { entityDisplayName, entityInitials } from "@/lib/entities";

const PAYROLL_CALENDARS = ["monthly", "fortnightly", "weekly"];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthName(month) {
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) return String(month ?? "-");
  return MONTH_NAMES[m - 1];
}

const emptyForm = {
  code: "",
  legal_name: "",
  trading_name: "",
  country_code: "",
  currency: "",
  timezone: "UTC",
  financial_year_start_month: "7",
  default_payroll_calendar: "monthly",
  registration_number: "",
  tax_identifier: "",
  notes: "",
};

export default function EntitiesPage() {
  const { refresh: refreshSwitcher } = useEntities();
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
    const { data, error: err } = await supabase
      .from("fin_entities")
      .select("*")
      .order("legal_name", { ascending: true });

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
  }, []);

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (entity) => {
    setEditingId(entity.id);
    setForm({
      code: entity.code || "",
      legal_name: entity.legal_name || "",
      trading_name: entity.trading_name || "",
      country_code: entity.country_code || "",
      currency: entity.currency || "",
      timezone: entity.timezone || "UTC",
      financial_year_start_month: entity.financial_year_start_month != null ? String(entity.financial_year_start_month) : "7",
      default_payroll_calendar: entity.default_payroll_calendar || "monthly",
      registration_number: entity.registration_number || "",
      tax_identifier: entity.tax_identifier || "",
      notes: entity.notes || "",
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
    setSaving(true);
    setError("");
    const supabase = createClient();

    const basePayload = {
      legal_name: form.legal_name.trim(),
      trading_name: form.trading_name.trim() || null,
      country_code: form.country_code.trim().toUpperCase(),
      currency: form.currency.trim().toUpperCase(),
      timezone: form.timezone.trim() || "UTC",
      financial_year_start_month: Number(form.financial_year_start_month) || 7,
      default_payroll_calendar: form.default_payroll_calendar,
      registration_number: form.registration_number.trim() || null,
      tax_identifier: form.tax_identifier.trim() || null,
      notes: form.notes.trim() || null,
    };

    if (editingId) {
      // code is frozen after insert - never sent on update.
      const { error: err } = await supabase.from("fin_entities").update(basePayload).eq("id", editingId);
      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: err } = await supabase.from("fin_entities").insert({
        ...basePayload,
        code: form.code.trim().toLowerCase(),
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
    await load();
    refreshSwitcher();
  };

  const toggleArchive = async (entity) => {
    const archiving = entity.status !== "archived";
    const confirmMsg = archiving
      ? `Archive ${entityDisplayName(entity)}? It will be hidden from active views but all of its data is preserved.`
      : `Restore ${entityDisplayName(entity)} to active status?`;
    if (!window.confirm(confirmMsg)) return;

    setBusyId(entity.id);
    const supabase = createClient();
    const { error: err } = await supabase
      .from("fin_entities")
      .update({
        status: archiving ? "archived" : "active",
        archived_at: archiving ? new Date().toISOString() : null,
      })
      .eq("id", entity.id);
    if (err) setError(err.message);
    await load();
    refreshSwitcher();
    setBusyId(null);
  };

  return (
    <AppShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#012E41", margin: 0 }}>Entities</h1>
          <p style={{ fontSize: 13, color: "#6b7c85", margin: "4px 0 0" }}>Legal entity registry - the cross-system join key for every financial record</p>
        </div>
        {!schemaMissing && (
          <button
            onClick={openAdd}
            style={{
              display: "flex", alignItems: "center", gap: 6, background: "#2BA99F", color: "#fff", border: "none",
              borderRadius: 8, padding: "10px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <Plus size={16} /> Add entity
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
          The entity registry migration has not been applied yet.
        </div>
      ) : (
        <>
          {formOpen && (
            <form onSubmit={submitForm} style={{ background: "#fff", borderRadius: 12, padding: 20, marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#012E41" }}>{editingId ? "Edit entity" : "Add entity"}</div>
                <button type="button" onClick={closeForm} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a99a0" }}><X size={16} /></button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
                <Field label="Code" required hint={editingId ? "frozen - cross-system join key" : "lowercase, kebab-case (e.g. fl-au)"}>
                  <input
                    required
                    disabled={!!editingId}
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })}
                    style={editingId ? { ...inputStyle, background: "#f2f4f5", color: "#8a99a0" } : inputStyle}
                  />
                </Field>
                <Field label="Legal name" required>
                  <input required value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Trading name">
                  <input value={form.trading_name} onChange={(e) => setForm({ ...form, trading_name: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Country code" required hint="2 letters, e.g. AU">
                  <input required maxLength={2} value={form.country_code} onChange={(e) => setForm({ ...form, country_code: e.target.value.toUpperCase() })} style={inputStyle} />
                </Field>
                <Field label="Currency" required hint="3 letters, e.g. AUD">
                  <input required maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} style={inputStyle} />
                </Field>
                <Field label="Timezone" required>
                  <input required value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Financial year start" required>
                  <select required value={form.financial_year_start_month} onChange={(e) => setForm({ ...form, financial_year_start_month: e.target.value })} style={inputStyle}>
                    {MONTH_NAMES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
                  </select>
                </Field>
                <Field label="Payroll calendar" required>
                  <select required value={form.default_payroll_calendar} onChange={(e) => setForm({ ...form, default_payroll_calendar: e.target.value })} style={inputStyle}>
                    {PAYROLL_CALENDARS.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </Field>
                <Field label="Registration number">
                  <input value={form.registration_number} onChange={(e) => setForm({ ...form, registration_number: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Tax identifier">
                  <input value={form.tax_identifier} onChange={(e) => setForm({ ...form, tax_identifier: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Notes">
                  <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={inputStyle} />
                </Field>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                <button type="submit" disabled={saving} style={{ background: "#012E41", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>
                  {saving ? "Saving..." : editingId ? "Save changes" : "Add entity"}
                </button>
                <button type="button" onClick={closeForm} style={{ background: "#f2f4f5", color: "#334", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.06)", overflow: "hidden" }}>
            {loading ? (
              <div style={{ padding: 24, color: "#6b7c85", fontSize: 13.5 }}>Loading entities...</div>
            ) : rows.length === 0 ? (
              <div style={{ padding: 24, color: "#8a99a0", fontSize: 13.5 }}>No entities yet. Add one to get started.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f6f8f9", textAlign: "left" }}>
                      <Th>Entity</Th>
                      <Th>Code</Th>
                      <Th>Country</Th>
                      <Th>Currency</Th>
                      <Th>Timezone</Th>
                      <Th>FY start</Th>
                      <Th>Payroll calendar</Th>
                      <Th>Registration #</Th>
                      <Th>Tax ID</Th>
                      <Th>Status</Th>
                      <Th align="right">Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((entity) => {
                      const archived = entity.status === "archived";
                      const busy = busyId === entity.id;
                      return (
                        <tr key={entity.id} style={{ borderTop: "1px solid #f0f2f3", opacity: archived ? 0.6 : 1 }}>
                          <Td>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{
                                width: 30, height: 30, borderRadius: 8, background: "rgba(43,169,159,.18)", color: "#1E8B82",
                                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0,
                              }}>
                                {entityInitials(entity) || "?"}
                              </div>
                              <div>
                                <div style={{ fontWeight: 600, color: "#012E41" }}>{entityDisplayName(entity)}</div>
                                {entity.trading_name && entity.legal_name !== entity.trading_name && (
                                  <div style={{ fontSize: 11, color: "#8a99a0" }}>{entity.legal_name}</div>
                                )}
                              </div>
                            </div>
                          </Td>
                          <Td style={{ fontFamily: "monospace", fontSize: 12 }}>{entity.code}</Td>
                          <Td>{entity.country_code}</Td>
                          <Td>{entity.currency}</Td>
                          <Td>{entity.timezone}</Td>
                          <Td>{monthName(entity.financial_year_start_month)}</Td>
                          <Td style={{ textTransform: "capitalize" }}>{entity.default_payroll_calendar}</Td>
                          <Td>{entity.registration_number || "-"}</Td>
                          <Td>{entity.tax_identifier || "-"}</Td>
                          <Td>
                            {archived ? (
                              <span style={{ background: "#F3F4F6", color: "#6B7280", borderRadius: 20, padding: "3px 10px", fontSize: 11.5, fontWeight: 600 }}>Archived</span>
                            ) : (
                              <span style={{ background: "#ECFDF5", color: "#047857", borderRadius: 20, padding: "3px 10px", fontSize: 11.5, fontWeight: 600 }}>Active</span>
                            )}
                          </Td>
                          <Td align="right">
                            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                              <button onClick={() => openEdit(entity)} disabled={busy} style={iconBtnStyle} title="Edit"><Pencil size={14} /></button>
                              {archived ? (
                                <button onClick={() => toggleArchive(entity)} disabled={busy} style={{ ...iconBtnStyle, color: "#1E8B82" }} title="Restore"><RotateCcw size={14} /></button>
                              ) : (
                                <button onClick={() => toggleArchive(entity)} disabled={busy} style={{ ...iconBtnStyle, color: "#B45309" }} title="Archive"><Archive size={14} /></button>
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
