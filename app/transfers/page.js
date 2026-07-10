"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, X, AlertTriangle } from "lucide-react";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase-browser";
import { useEntities } from "@/lib/useEntities";
import { isMissingSchemaError } from "@/lib/payrollSnapshots";
import { entityDisplayName } from "@/lib/entities";
import { transfersForEntity, nextTransferActions } from "@/lib/banking";
import { formatCurrency, formatDate, todayISO } from "@/lib/format";

const STATUS_CHIPS = {
  planned: { bg: "#FFFBEB", color: "#92400E", label: "Planned" },
  in_transit: { bg: "#EFF6FF", color: "#1D4ED8", label: "In transit" },
  settled: { bg: "#ECFDF5", color: "#047857", label: "Settled" },
  cancelled: { bg: "#F3F4F6", color: "#6B7280", label: "Cancelled" },
};

const ACTION_LABELS = {
  mark_in_transit: "Mark in transit",
  settle: "Settle",
  cancel: "Cancel",
  delete: "Delete",
};

const emptyForm = {
  from_bank_account_id: "",
  to_bank_account_id: "",
  amount: "",
  currency: "",
  transfer_date: todayISO(),
  reference: "",
  note: "",
};

function accountOptionLabel(account) {
  if (!account) return "";
  return `${entityDisplayName(account.entity)} - ${account.account_name} (${account.currency})`;
}

export default function TransfersPage() {
  const { currentEntity, allSelected } = useEntities();
  const [bankAccounts, setBankAccounts] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const [accountsRes, transfersRes] = await Promise.all([
      supabase
        .from("fin_bank_accounts")
        .select("*, entity:fin_entities(id, code, legal_name, trading_name, currency)")
        .order("bank_name", { ascending: true }),
      supabase.from("fin_transfers").select("*").order("transfer_date", { ascending: false }),
    ]);

    if ((accountsRes.error && isMissingSchemaError(accountsRes.error)) || (transfersRes.error && isMissingSchemaError(transfersRes.error))) {
      setSchemaMissing(true);
      setBankAccounts([]);
      setTransfers([]);
      setLoading(false);
      return;
    }
    const firstError = accountsRes.error || transfersRes.error;
    if (firstError) {
      setError(firstError.message);
      setBankAccounts([]);
      setTransfers([]);
      setLoading(false);
      return;
    }

    setSchemaMissing(false);
    setBankAccounts(accountsRes.data || []);
    setTransfers(transfersRes.data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const accountsById = useMemo(() => {
    const map = {};
    for (const a of bankAccounts) map[a.id] = a;
    return map;
  }, [bankAccounts]);

  const selectableAccounts = useMemo(
    () => bankAccounts.filter((a) => a.status !== "closed"),
    [bankAccounts]
  );

  const filteredTransfers = useMemo(() => {
    const entityId = allSelected ? "all" : currentEntity?.id;
    return transfersForEntity(transfers, entityId);
  }, [transfers, allSelected, currentEntity]);

  const fromAccount = accountsById[form.from_bank_account_id];
  const toAccount = accountsById[form.to_bank_account_id];
  const currencyMismatch = !!(fromAccount && toAccount && fromAccount.currency !== toAccount.currency);

  const openAdd = () => {
    setForm(emptyForm);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setForm(emptyForm);
  };

  const handleFromChange = (id) => {
    const acct = accountsById[id];
    setForm((f) => ({ ...f, from_bank_account_id: id, currency: acct?.currency || f.currency }));
  };

  const submitForm = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.from_bank_account_id || !form.to_bank_account_id) {
      setError("Select both the from and to accounts.");
      return;
    }
    if (form.from_bank_account_id === form.to_bank_account_id) {
      setError("The from and to accounts must be different.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: err } = await supabase.from("fin_transfers").insert({
      from_bank_account_id: form.from_bank_account_id,
      to_bank_account_id: form.to_bank_account_id,
      amount: Number(form.amount) || 0,
      currency: form.currency.trim().toUpperCase(),
      transfer_date: form.transfer_date || todayISO(),
      reference: form.reference.trim() || null,
      note: form.note.trim() || null,
      created_by: user?.id || null,
    });
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    closeForm();
    load();
  };

  const runAction = async (transfer, updater, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusyId(transfer.id);
    setError("");
    const supabase = createClient();
    const err = await updater(supabase, transfer);
    if (err) setError(err.message);
    await load();
    setBusyId(null);
  };

  const markInTransit = (t) =>
    runAction(t, async (supabase, row) => {
      const { error: err } = await supabase.from("fin_transfers").update({ status: "in_transit" }).eq("id", row.id);
      return err;
    });

  const settleTransfer = (t) =>
    runAction(t, async (supabase, row) => {
      const { error: err } = await supabase
        .from("fin_transfers")
        .update({ status: "settled", settled_at: new Date().toISOString() })
        .eq("id", row.id);
      return err;
    });

  const cancelTransfer = (t) =>
    runAction(
      t,
      async (supabase, row) => {
        const { error: err } = await supabase.from("fin_transfers").update({ status: "cancelled" }).eq("id", row.id);
        return err;
      },
      "Cancel this transfer?"
    );

  const deleteTransfer = (t) =>
    runAction(
      t,
      async (supabase, row) => {
        const { error: err } = await supabase.from("fin_transfers").delete().eq("id", row.id);
        return err;
      },
      "Delete this transfer? This cannot be undone."
    );

  const ACTION_HANDLERS = {
    mark_in_transit: markInTransit,
    settle: settleTransfer,
    cancel: cancelTransfer,
    delete: deleteTransfer,
  };

  return (
    <AppShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#012E41", margin: 0 }}>Transfers</h1>
          <p style={{ fontSize: 13, color: "#6b7c85", margin: "4px 0 0" }}>Cash movements between bank accounts, including intercompany transfers</p>
        </div>
        {!schemaMissing && (
          <button
            onClick={openAdd}
            style={{
              display: "flex", alignItems: "center", gap: 6, background: "#2BA99F", color: "#fff", border: "none",
              borderRadius: 8, padding: "10px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <Plus size={16} /> New transfer
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
          The bank account / transfer migration has not been applied yet.
        </div>
      ) : (
        <>
          {formOpen && (
            <form onSubmit={submitForm} style={{ background: "#fff", borderRadius: 12, padding: 20, marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#012E41" }}>New transfer</div>
                <button type="button" onClick={closeForm} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a99a0" }}><X size={16} /></button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
                <Field label="From account" required>
                  <select required value={form.from_bank_account_id} onChange={(e) => handleFromChange(e.target.value)} style={inputStyle}>
                    <option value="" disabled>Select...</option>
                    {selectableAccounts.map((a) => <option key={a.id} value={a.id}>{accountOptionLabel(a)}</option>)}
                  </select>
                </Field>
                <Field label="To account" required>
                  <select required value={form.to_bank_account_id} onChange={(e) => setForm({ ...form, to_bank_account_id: e.target.value })} style={inputStyle}>
                    <option value="" disabled>Select...</option>
                    {selectableAccounts.map((a) => <option key={a.id} value={a.id}>{accountOptionLabel(a)}</option>)}
                  </select>
                </Field>
                <Field label="Amount" required>
                  <input required type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Currency" required hint="3 letters, e.g. AUD">
                  <input required maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} style={inputStyle} />
                </Field>
                <Field label="Transfer date" required>
                  <input required type="date" value={form.transfer_date} onChange={(e) => setForm({ ...form, transfer_date: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Reference">
                  <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Note">
                  <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={inputStyle} />
                </Field>
              </div>

              {currencyMismatch && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", borderRadius: 8, padding: "10px 14px", fontSize: 12.5 }}>
                  <AlertTriangle size={15} />
                  The from and to accounts use different currencies ({fromAccount.currency} to {toAccount.currency}). FX rate handling arrives in Phase 3 - this transfer is recorded at face value in the currency entered above.
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                <button type="submit" disabled={saving} style={{ background: "#012E41", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>
                  {saving ? "Saving..." : "Create transfer"}
                </button>
                <button type="button" onClick={closeForm} style={{ background: "#f2f4f5", color: "#334", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.06)", overflow: "hidden" }}>
            {loading ? (
              <div style={{ padding: 24, color: "#6b7c85", fontSize: 13.5 }}>Loading transfers...</div>
            ) : filteredTransfers.length === 0 ? (
              <div style={{ padding: 24, color: "#8a99a0", fontSize: 13.5 }}>No transfers in this view.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, whiteSpace: "nowrap" }}>
                  <thead>
                    <tr style={{ background: "#f6f8f9", textAlign: "left" }}>
                      <Th>Date</Th>
                      <Th>From</Th>
                      <Th>To</Th>
                      <Th align="right">Amount</Th>
                      <Th>Status</Th>
                      <Th>Reference / note</Th>
                      <Th align="right">Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransfers.map((t) => {
                      const from = accountsById[t.from_bank_account_id];
                      const to = accountsById[t.to_bank_account_id];
                      const busy = busyId === t.id;
                      const chip = STATUS_CHIPS[t.status] || STATUS_CHIPS.planned;
                      const actions = nextTransferActions(t.status);
                      return (
                        <tr key={t.id} style={{ borderTop: "1px solid #f0f2f3" }}>
                          <Td>{formatDate(t.transfer_date)}</Td>
                          <Td>
                            {from ? (
                              <>
                                <div style={{ fontWeight: 600, color: "#012E41" }}>{entityDisplayName(from.entity)}</div>
                                <div style={{ fontSize: 11, color: "#8a99a0" }}>{from.account_name}</div>
                              </>
                            ) : "Unknown account"}
                          </Td>
                          <Td>
                            {to ? (
                              <>
                                <div style={{ fontWeight: 600, color: "#012E41" }}>{entityDisplayName(to.entity)}</div>
                                <div style={{ fontSize: 11, color: "#8a99a0" }}>{to.account_name}</div>
                              </>
                            ) : "Unknown account"}
                            {t.is_intercompany && (
                              <div style={{ marginTop: 4 }}>
                                <span style={{ background: "#EDE9FE", color: "#6D28D9", borderRadius: 20, padding: "2px 8px", fontSize: 10.5, fontWeight: 600 }}>Intercompany</span>
                              </div>
                            )}
                          </Td>
                          <Td align="right" style={{ fontWeight: 600 }}>{formatCurrency(t.amount, t.currency)}</Td>
                          <Td>
                            <span style={{ background: chip.bg, color: chip.color, borderRadius: 20, padding: "3px 10px", fontSize: 11.5, fontWeight: 600 }}>{chip.label}</span>
                          </Td>
                          <Td style={{ whiteSpace: "normal" }}>
                            {t.reference && <div>{t.reference}</div>}
                            {t.note && <div style={{ fontSize: 11, color: "#8a99a0" }}>{t.note}</div>}
                            {!t.reference && !t.note && "-"}
                          </Td>
                          <Td align="right">
                            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                              {actions.map((action) => (
                                <button
                                  key={action}
                                  onClick={() => ACTION_HANDLERS[action](t)}
                                  disabled={busy}
                                  style={action === "delete" || action === "cancel" ? { ...linkBtnStyle, color: "#B91C1C" } : linkBtnStyle}
                                >
                                  {ACTION_LABELS[action]}
                                </button>
                              ))}
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

const linkBtnStyle = {
  border: "none", background: "none", color: "#2BA99F", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: 0, fontFamily: "inherit",
};
