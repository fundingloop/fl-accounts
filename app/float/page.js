"use client";

import { useEffect, useMemo, useState } from "react";
import { Settings2, PlusCircle, RefreshCcw, Trash2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase-browser";
import { useFloatAccount } from "@/lib/useFloatAccount";
import { computeCurrentBalance } from "@/lib/forecast";
import { formatCurrency, formatDate, todayISO } from "@/lib/format";

const CURRENCY_OPTIONS = ["NPR", "AUD", "USD", "INR"];

export default function FloatPage() {
  const { account, loading: accountLoading, refresh } = useFloatAccount();
  const [bills, setBills] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Account settings form
  const [settingsForm, setSettingsForm] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Deposit form
  const [depositForm, setDepositForm] = useState({ deposit_date: todayISO(), amount: "", note: "" });
  const [savingDeposit, setSavingDeposit] = useState(false);
  const [busyDepositId, setBusyDepositId] = useState(null);

  // Re-baseline
  const [rebaselineOpen, setRebaselineOpen] = useState(false);
  const [rebaselineValue, setRebaselineValue] = useState("");
  const [rebaselining, setRebaselining] = useState(false);

  const loadData = async (accountId) => {
    setLoading(true);
    const supabase = createClient();
    const [billsRes, depositsRes] = await Promise.all([
      supabase.from("bills").select("*").eq("account_id", accountId),
      supabase.from("float_deposits").select("*").eq("account_id", accountId).order("deposit_date", { ascending: false }),
    ]);
    if (billsRes.error) setError(billsRes.error.message);
    if (depositsRes.error) setError(depositsRes.error.message);
    setBills(billsRes.data || []);
    setDeposits(depositsRes.data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (account?.id) loadData(account.id);
  }, [account?.id]);

  useEffect(() => {
    if (account) {
      setSettingsForm({
        starting_float: account.starting_float !== undefined && account.starting_float !== null ? String(account.starting_float) : "",
        currency: account.currency || "NPR",
        float_as_of_date: account.float_as_of_date || todayISO(),
      });
    }
  }, [account]);

  const currency = account?.currency || "NPR";

  const currentBalance = useMemo(() => {
    if (!account) return 0;
    return computeCurrentBalance({
      startingFloat: account.starting_float,
      floatAsOfDate: account.float_as_of_date,
      deposits,
      bills,
    });
  }, [account, deposits, bills]);

  const depositsSinceAsOf = useMemo(() => {
    if (!account) return 0;
    const asOf = account.float_as_of_date;
    const today = todayISO();
    return deposits
      .filter((d) => d.deposit_date >= asOf && d.deposit_date <= today)
      .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  }, [account, deposits]);

  const billsPaidSinceAsOf = useMemo(() => {
    if (!account) return 0;
    const asOf = account.float_as_of_date;
    const today = todayISO();
    return bills
      .filter((b) => b.paid && b.paid_date && b.paid_date >= asOf && b.paid_date <= today)
      .reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
  }, [account, bills]);

  const saveSettings = async (e) => {
    e.preventDefault();
    if (!account?.id) return;
    if (settingsForm.currency !== account.currency) {
      if (!window.confirm("Changing the currency does not convert any existing amounts - all bills, deposits and the starting float keep their numbers and are simply relabelled. Continue?")) {
        return;
      }
    }
    setSavingSettings(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase
      .from("float_accounts")
      .update({
        starting_float: Number(settingsForm.starting_float) || 0,
        currency: settingsForm.currency,
        float_as_of_date: settingsForm.float_as_of_date,
      })
      .eq("id", account.id);
    if (err) setError(err.message);
    setSavingSettings(false);
    refresh();
  };

  const addDeposit = async (e) => {
    e.preventDefault();
    if (!account?.id) return;
    setSavingDeposit(true);
    setError("");
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: err } = await supabase.from("float_deposits").insert({
      account_id: account.id,
      deposit_date: depositForm.deposit_date,
      amount: Number(depositForm.amount) || 0,
      note: depositForm.note.trim() || null,
      created_by: user?.id || null,
    });
    if (err) {
      setError(err.message);
      setSavingDeposit(false);
      return;
    }
    setSavingDeposit(false);
    setDepositForm({ deposit_date: todayISO(), amount: "", note: "" });
    loadData(account.id);
  };

  const deleteDeposit = async (deposit) => {
    if (!window.confirm("Delete this deposit? This cannot be undone.")) return;
    setBusyDepositId(deposit.id);
    const supabase = createClient();
    const { error: err } = await supabase.from("float_deposits").delete().eq("id", deposit.id);
    if (err) setError(err.message);
    await loadData(account.id);
    setBusyDepositId(null);
  };

  const submitRebaseline = async (e) => {
    e.preventDefault();
    if (!account?.id) return;
    setRebaselining(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase
      .from("float_accounts")
      .update({
        starting_float: Number(rebaselineValue) || 0,
        float_as_of_date: todayISO(),
      })
      .eq("id", account.id);
    if (err) {
      setError(err.message);
      setRebaselining(false);
      return;
    }
    setRebaselining(false);
    setRebaselineOpen(false);
    setRebaselineValue("");
    refresh();
  };

  if (accountLoading || !settingsForm) {
    return (
      <AppShell>
        <div style={{ color: "#6b7c85", fontSize: 14 }}>Loading...</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#012E41", margin: 0 }}>Float</h1>
        <p style={{ fontSize: 13, color: "#6b7c85", margin: "4px 0 0" }}>Starting float, deposits and reconciliation</p>
      </div>

      {error && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, marginBottom: 20 }}>
        {/* Reconciliation */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#012E41", marginBottom: 14 }}>Reconciliation</div>
          <ReconRow label="Starting float" value={formatCurrency(account.starting_float, currency)} />
          <ReconRow label={`Deposits in (since ${formatDate(account.float_as_of_date)})`} value={"+ " + formatCurrency(depositsSinceAsOf, currency)} positive />
          <ReconRow label="Bills paid out" value={"- " + formatCurrency(billsPaidSinceAsOf, currency)} negative />
          <div style={{ borderTop: "1px solid #eef2f3", marginTop: 10, paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "#012E41" }}>Balance now</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#012E41" }}>{formatCurrency(currentBalance, currency)}</span>
          </div>

          <div style={{ marginTop: 16 }}>
            {!rebaselineOpen ? (
              <button
                onClick={() => setRebaselineOpen(true)}
                style={{ display: "flex", alignItems: "center", gap: 6, background: "#f2f4f5", color: "#012E41", border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              >
                <RefreshCcw size={14} /> Re-baseline to actual
              </button>
            ) : (
              <form onSubmit={submitRebaseline} style={{ background: "#f6f8f9", borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 12, color: "#6b7c85", marginBottom: 8 }}>
                  Enter the real bank balance today. This resets accumulated drift (fees, FX, unlogged spend) - it sets starting float to this value and balance-as-of to today.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="number" step="0.01" required autoFocus placeholder={`Actual balance (${currency})`}
                    value={rebaselineValue} onChange={(e) => setRebaselineValue(e.target.value)}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button type="submit" disabled={rebaselining} style={{ background: "#2BA99F", color: "#fff", border: "none", borderRadius: 7, padding: "0 16px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                    {rebaselining ? "Saving..." : "Confirm"}
                  </button>
                  <button type="button" onClick={() => { setRebaselineOpen(false); setRebaselineValue(""); }} style={{ background: "none", color: "#6b7c85", border: "none", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Account settings */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Settings2 size={16} color="#2BA99F" />
            <div style={{ fontSize: 14, fontWeight: 600, color: "#012E41" }}>Account settings</div>
          </div>
          <form onSubmit={saveSettings}>
            <Field label="Starting float">
              <input type="number" step="0.01" value={settingsForm.starting_float} onChange={(e) => setSettingsForm({ ...settingsForm, starting_float: e.target.value })} style={inputStyle} />
            </Field>
            <div style={{ height: 12 }} />
            <Field label="Currency">
              <select value={settingsForm.currency} onChange={(e) => setSettingsForm({ ...settingsForm, currency: e.target.value })} style={inputStyle}>
                {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <div style={{ height: 12 }} />
            <Field label="Balance as of">
              <input type="date" value={settingsForm.float_as_of_date} onChange={(e) => setSettingsForm({ ...settingsForm, float_as_of_date: e.target.value })} style={inputStyle} />
            </Field>
            <button type="submit" disabled={savingSettings} style={{ marginTop: 16, background: "#012E41", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              {savingSettings ? "Saving..." : "Save settings"}
            </button>
          </form>
        </div>
      </div>

      {/* Deposits */}
      <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#012E41", marginBottom: 14 }}>Deposits / top-ups</div>

        <form onSubmit={addDeposit} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 18 }}>
          <Field label="Date">
            <input type="date" required value={depositForm.deposit_date} onChange={(e) => setDepositForm({ ...depositForm, deposit_date: e.target.value })} style={inputStyle} />
          </Field>
          <Field label={`Amount (${currency})`}>
            <input type="number" step="0.01" required min="0" value={depositForm.amount} onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Note">
            <input value={depositForm.note} onChange={(e) => setDepositForm({ ...depositForm, note: e.target.value })} style={{ ...inputStyle, minWidth: 200 }} />
          </Field>
          <button type="submit" disabled={savingDeposit} style={{ display: "flex", alignItems: "center", gap: 6, background: "#2BA99F", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", height: 37 }}>
            <PlusCircle size={15} /> Log deposit
          </button>
        </form>

        {loading ? (
          <div style={{ color: "#6b7c85", fontSize: 13.5 }}>Loading deposits...</div>
        ) : deposits.length === 0 ? (
          <div style={{ color: "#8a99a0", fontSize: 13.5 }}>No deposits logged yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f6f8f9", textAlign: "left" }}>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Note</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((d) => {
                  const future = d.deposit_date > todayISO();
                  return (
                    <tr key={d.id} style={{ borderTop: "1px solid #f0f2f3" }}>
                      <td style={tdStyle}>
                        {formatDate(d.deposit_date)}
                        {future && <span style={{ marginLeft: 8, fontSize: 11, color: "#2BA99F", fontWeight: 600 }}>Upcoming</span>}
                      </td>
                      <td style={tdStyle}>{d.note || "-"}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>{formatCurrency(d.amount, currency)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <button onClick={() => deleteDeposit(d)} disabled={busyDepositId === d.id} style={{ border: "none", background: "none", cursor: "pointer", color: "#B91C1C", padding: 4 }} title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ReconRow({ label, value, positive, negative }) {
  const color = positive ? "#1E8B82" : negative ? "#B91C1C" : "#334";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", color: "#334" }}>
      <span style={{ color: "#6b7c85" }}>{label}</span>
      <span style={{ fontWeight: 600, color }}>{value}</span>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334", marginBottom: 5 }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%", padding: "8px 10px", border: "1px solid #d7dee1", borderRadius: 7, fontSize: 13, fontFamily: "inherit", outline: "none",
};

const thStyle = {
  padding: "10px 14px", fontSize: 11.5, fontWeight: 700, color: "#6b7c85", textTransform: "uppercase", letterSpacing: ".03em",
};

const tdStyle = {
  padding: "10px 14px", color: "#334",
};
