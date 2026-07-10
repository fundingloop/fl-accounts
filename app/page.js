"use client";

import { useEffect, useMemo, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { AlertTriangle, TrendingDown, Wallet, Building2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase-browser";
import { useFloatAccount } from "@/lib/useFloatAccount";
import { useEntities } from "@/lib/useEntities";
import {
  buildForecast,
  outstandingTotal,
  overdueSummary,
  dueSoonSummary,
  computeCurrentBalance,
  forecastSummary,
} from "@/lib/forecast";
import { payrollForecastEvents, payrollMonthlyCashCost } from "@/lib/payrollForecast";
import { isMissingSchemaError, latestSnapshot, snapshotsForEntity } from "@/lib/payrollSnapshots";
import { transfersForEntity } from "@/lib/banking";
import { entityDisplayName } from "@/lib/entities";
import { formatCurrency, formatDate, todayISO } from "@/lib/format";

function Card({ label, value, sub, tone }) {
  const toneColor = tone === "danger" ? "#B91C1C" : tone === "warn" ? "#B45309" : "#012E41";
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,.06)", flex: 1, minWidth: 200 }}>
      <div style={{ fontSize: 12, color: "#6b7c85", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: toneColor, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: "#8a99a0", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SummaryRow({ label, value, strong }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f0f2f3", fontSize: 13 }}>
      <span style={{ color: "#6b7c85" }}>{label}</span>
      <span style={{ fontWeight: strong ? 700 : 600, color: "#012E41" }}>{value}</span>
    </div>
  );
}

function UpcomingCard({ title, children }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#012E41", marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function EmptyNote({ text }) {
  return <div style={{ fontSize: 12.5, color: "#8a99a0" }}>{text}</div>;
}

function ErrorBanner({ text }) {
  return (
    <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13 }}>
      {text}
    </div>
  );
}

function daysFromToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function DashboardPage() {
  const { entities, currentEntity, allSelected, loading: entitiesLoading } = useEntities();

  return (
    <AppShell>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#012E41", margin: 0 }}>Dashboard</h1>
        <p style={{ fontSize: 13, color: "#6b7c85", margin: "4px 0 0" }}>
          {allSelected
            ? "Group cashflow across all entities"
            : `${currentEntity ? entityDisplayName(currentEntity) : "Loading account..."} float and 6-month cashflow forecast`}
        </p>
      </div>

      {allSelected ? (
        <GroupDashboard entities={entities} entitiesLoading={entitiesLoading} />
      ) : (
        <SingleEntityDashboard currentEntity={currentEntity} />
      )}
    </AppShell>
  );
}

// ---- single-entity mode ---------------------------------------------------

function SingleEntityDashboard({ currentEntity }) {
  const { account, loading: accountLoading, error: accountError } = useFloatAccount();
  const [bills, setBills] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [loading, setLoading] = useState(true);

  // Finalised payroll, read-only mirror for the forecast - this page never
  // calls the sync RPC (the payroll page owns capturing new runs); it only
  // reads whatever payroll_run_snapshots rows already exist, then scopes
  // them to the currently selected entity.
  const [payrollSnapshots, setPayrollSnapshots] = useState([]);
  const [payrollSchemaMissing, setPayrollSchemaMissing] = useState(false);
  const [payrollError, setPayrollError] = useState("");

  // Transfers - read-only, tolerant of the banking migration not being live.
  const [transfers, setTransfers] = useState([]);
  const [transfersSchemaMissing, setTransfersSchemaMissing] = useState(false);

  useEffect(() => {
    if (!account?.id) {
      // No account resolved (still loading, or genuinely none) - clear our own
      // loading flag so the page never gets stuck on "Loading..." waiting for a
      // fetch that will not run.
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const supabase = createClient();
    Promise.all([
      supabase.from("bills").select("*").eq("account_id", account.id),
      supabase.from("float_deposits").select("*").eq("account_id", account.id),
    ]).then(([billsRes, depositsRes]) => {
      if (cancelled) return;
      setBills(billsRes.data || []);
      setDeposits(depositsRes.data || []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [account?.id]);

  // Payroll snapshots - independent of the float account, read-only, and
  // tolerant of the snapshot migration not being applied yet.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("payroll_run_snapshots")
      .select("*")
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err && isMissingSchemaError(err)) {
          setPayrollSchemaMissing(true);
          setPayrollSnapshots([]);
        } else if (err) {
          setPayrollError(err.message || "Could not load payroll run history.");
          setPayrollSnapshots([]);
        } else {
          setPayrollSchemaMissing(false);
          setPayrollSnapshots(data || []);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Transfers - independent load, tolerant of the banking migration not
  // being applied yet (isMissingSchemaError -> hide the card's content).
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("fin_transfers")
      .select("*")
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err && isMissingSchemaError(err)) {
          setTransfersSchemaMissing(true);
          setTransfers([]);
        } else if (!err) {
          setTransfersSchemaMissing(false);
          setTransfers(data || []);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scopedSnapshots = useMemo(() => snapshotsForEntity(payrollSnapshots, currentEntity), [payrollSnapshots, currentEntity]);
  const payrollEvents = useMemo(() => payrollForecastEvents({ snapshots: scopedSnapshots }), [scopedSnapshots]);
  const payrollLatest = useMemo(() => latestSnapshot(scopedSnapshots), [scopedSnapshots]);

  const forecast = useMemo(() => {
    if (!account) return null;
    return buildForecast({
      startingFloat: account.starting_float,
      floatAsOfDate: account.float_as_of_date,
      deposits,
      bills,
      extraEvents: payrollEvents,
    });
  }, [account, bills, deposits, payrollEvents]);

  const summary = useMemo(() => (forecast ? forecastSummary(forecast) : null), [forecast]);

  const outstanding = useMemo(() => outstandingTotal(bills), [bills]);
  const overdue = useMemo(() => overdueSummary(bills), [bills]);
  const dueSoon = useMemo(() => dueSoonSummary(bills), [bills]);
  const currency = currentEntity?.currency || account?.currency || "NPR";
  const dipsBelowZero = forecast && forecast.lowest.balance < 0;

  const nextPayroll = useMemo(() => payrollEvents.find((e) => e.kind === "payroll_net") || null, [payrollEvents]);
  const upcomingTax = useMemo(
    () => payrollEvents.filter((e) => e.kind === "payroll_ssf" || e.kind === "payroll_tds").slice(0, 3),
    [payrollEvents]
  );
  const upcomingBills = useMemo(() => {
    const today = todayISO();
    const horizon = daysFromToday(14);
    return bills
      .filter((b) => !b.paid && b.due_date && b.due_date >= today && b.due_date <= horizon)
      .sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0))
      .slice(0, 5);
  }, [bills]);
  const upcomingTransfers = useMemo(() => {
    if (transfersSchemaMissing) return [];
    const today = todayISO();
    const entityId = currentEntity?.id || null;
    return transfersForEntity(transfers, entityId)
      .filter((t) => (t.status === "planned" || t.status === "in_transit") && t.transfer_date >= today)
      .sort((a, b) => (a.transfer_date < b.transfer_date ? -1 : a.transfer_date > b.transfer_date ? 1 : 0));
  }, [transfers, transfersSchemaMissing, currentEntity]);

  return (
    <>
      {accountError && <ErrorBanner text={accountError} />}
      {payrollError && <ErrorBanner text={payrollError} />}

      {accountLoading ? (
        <div style={{ color: "#6b7c85", fontSize: 14 }}>Loading...</div>
      ) : !account ? (
        <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,.06)", color: "#6b7c85", fontSize: 13.5 }}>
          No float account found. {accountError ? "" : "Run the fl-accounts migration and reload."}
        </div>
      ) : (
        <>
          {/* Hero */}
          <div
            style={{
              background: "linear-gradient(135deg, #012E41, #0A3E54)",
              borderRadius: 14,
              padding: "26px 28px",
              color: "#fff",
              marginBottom: 20,
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 10, background: "rgba(43,169,159,.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Wallet size={22} color="#2BA99F" />
            </div>
            <div>
              <div style={{ fontSize: 12.5, color: "#9fc4c0", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>Current float balance</div>
              <div style={{ fontSize: 32, fontWeight: 700, marginTop: 2 }}>
                {forecast ? formatCurrency(forecast.currentBalance, currency) : "-"}
              </div>
            </div>
          </div>

          {dipsBelowZero && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "#FFFBEB",
                border: "1px solid #FDE68A",
                color: "#92400E",
                borderRadius: 10,
                padding: "12px 16px",
                marginBottom: 20,
                fontSize: 13.5,
              }}
            >
              <AlertTriangle size={18} />
              <span>
                Projected balance dips to <strong>{formatCurrency(forecast.lowest.balance, currency)}</strong> on{" "}
                <strong>{formatDate(forecast.lowest.date)}</strong>. Plan a top-up before then.
              </span>
            </div>
          )}

          {/* Cards */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
            <Card label="Outstanding" value={formatCurrency(outstanding, currency)} sub="Total of all unpaid bills" />
            <Card
              label="Overdue"
              value={`${overdue.count} bill${overdue.count === 1 ? "" : "s"}`}
              sub={formatCurrency(overdue.amount, currency)}
              tone={overdue.count > 0 ? "danger" : undefined}
            />
            <Card
              label="Due in next 7 days"
              value={`${dueSoon.count} bill${dueSoon.count === 1 ? "" : "s"}`}
              sub={formatCurrency(dueSoon.amount, currency)}
              tone={dueSoon.count > 0 ? "warn" : undefined}
            />
          </div>

          {/* Forecast chart */}
          <div style={{ background: "#fff", borderRadius: 12, padding: "20px 20px 8px", boxShadow: "0 1px 3px rgba(0,0,0,.06)", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <TrendingDown size={16} color="#2BA99F" />
              <div style={{ fontSize: 14, fontWeight: 600, color: "#012E41" }}>6-month cashflow forecast</div>
            </div>
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={forecast?.series || []} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
                  <defs>
                    <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2BA99F" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#2BA99F" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f3" />
                  <XAxis dataKey="date" tickFormatter={(d) => formatDate(d)} tick={{ fontSize: 11, fill: "#8a99a0" }} minTickGap={30} />
                  <YAxis tickFormatter={(v) => formatCurrency(v, currency)} tick={{ fontSize: 11, fill: "#8a99a0" }} width={90} />
                  <Tooltip
                    formatter={(value) => [formatCurrency(value, currency), "Balance"]}
                    labelFormatter={(d) => formatDate(d)}
                    contentStyle={{ fontSize: 12.5, borderRadius: 8, border: "1px solid #eee" }}
                  />
                  <ReferenceLine y={0} stroke="#B91C1C" strokeDasharray="4 4" />
                  <Area type="stepAfter" dataKey="balance" stroke="#2BA99F" strokeWidth={2} fill="url(#balanceFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 12, color: "#8a99a0", padding: "10px 2px 16px" }}>
              {payrollSchemaMissing || scopedSnapshots.length === 0
                ? "Payroll is not included in this projection (no finalised payroll runs captured yet)."
                : `Includes payroll from finalised runs: ~${formatCurrency(payrollMonthlyCashCost(payrollLatest), currency)}/month (net wages + SSF + TDS; remittances approximated at day 15/25 of the following month).`}
            </div>
          </div>

          {/* 6-month forecast summary */}
          {summary && (
            <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)", marginBottom: 20, maxWidth: 420 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#012E41", marginBottom: 10 }}>6-month forecast summary</div>
              <SummaryRow label="Opening balance" value={formatCurrency(summary.opening, currency)} />
              <SummaryRow label="Expected income" value={formatCurrency(summary.income, currency)} />
              <SummaryRow label="Expected expenses" value={formatCurrency(summary.expenses, currency)} />
              <SummaryRow label="Payroll" value={formatCurrency(summary.payroll, currency)} />
              <SummaryRow label="Tax" value={formatCurrency(summary.tax, currency)} />
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, fontSize: 14 }}>
                <span style={{ fontWeight: 700, color: "#012E41" }}>Closing balance</span>
                <span style={{ fontWeight: 700, color: summary.closing < 0 ? "#B91C1C" : "#012E41" }}>
                  {formatCurrency(summary.closing, currency)}
                </span>
              </div>
            </div>
          )}

          {/* Upcoming */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            <UpcomingCard title="Upcoming payroll">
              {nextPayroll ? (
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#012E41" }}>{formatCurrency(Math.abs(nextPayroll.amount), currency)}</div>
                  <div style={{ fontSize: 11.5, color: "#8a99a0", marginTop: 2 }}>{formatDate(nextPayroll.date)}</div>
                </div>
              ) : (
                <EmptyNote text="None in horizon" />
              )}
            </UpcomingCard>

            <UpcomingCard title="Upcoming bills">
              {upcomingBills.length === 0 ? (
                <EmptyNote text="None due in the next 14 days" />
              ) : (
                upcomingBills.map((b) => (
                  <div key={b.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "4px 0" }}>
                    <span style={{ color: "#334", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.description}</span>
                    <span style={{ color: "#6b7c85", flexShrink: 0 }}>
                      {formatDate(b.due_date)} &middot; {formatCurrency(b.amount, currency)}
                    </span>
                  </div>
                ))
              )}
            </UpcomingCard>

            <UpcomingCard title="Upcoming tax">
              {upcomingTax.length === 0 ? (
                <EmptyNote text="None in horizon" />
              ) : (
                upcomingTax.map((e, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "4px 0" }}>
                    <span style={{ color: "#334", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.description}</span>
                    <span style={{ color: "#6b7c85", flexShrink: 0 }}>
                      {formatDate(e.date)} &middot; {formatCurrency(Math.abs(e.amount), currency)}
                    </span>
                  </div>
                ))
              )}
            </UpcomingCard>

            <UpcomingCard title="Upcoming transfers">
              {transfersSchemaMissing ? (
                <EmptyNote text="Transfers not live yet" />
              ) : upcomingTransfers.length === 0 ? (
                <EmptyNote text="None planned" />
              ) : (
                upcomingTransfers.map((t) => (
                  <div key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "4px 0" }}>
                    <span style={{ color: "#334" }}>{formatDate(t.transfer_date)}</span>
                    <span style={{ color: "#6b7c85" }}>{formatCurrency(t.amount, t.currency)}</span>
                  </div>
                ))
              )}
            </UpcomingCard>
          </div>
        </>
      )}
    </>
  );
}

// ---- all-entities mode -----------------------------------------------------

function GroupDashboard({ entities, entitiesLoading }) {
  const [floatAccounts, setFloatAccounts] = useState([]);
  const [bills, setBills] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // One-off load of every float_accounts/bills/float_deposits/payroll_run_snapshots
  // row, grouped client-side per entity below. Tolerant of the snapshot
  // migration not being applied yet.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const supabase = createClient();
    Promise.all([
      supabase.from("float_accounts").select("*"),
      supabase.from("bills").select("*"),
      supabase.from("float_deposits").select("*"),
      supabase.from("payroll_run_snapshots").select("*"),
    ]).then(([faRes, billsRes, depRes, snapRes]) => {
      if (cancelled) return;
      const hardError =
        faRes.error || billsRes.error || depRes.error || (snapRes.error && !isMissingSchemaError(snapRes.error) ? snapRes.error : null);
      if (hardError) setError(hardError.message || "Could not load group data.");
      setFloatAccounts(faRes.data || []);
      setBills(billsRes.data || []);
      setDeposits(depRes.data || []);
      setSnapshots(snapRes.error ? [] : snapRes.data || []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    return entities.map((entity) => {
      // Virtual pre-migration entity: the single float_accounts row it was
      // built from. Otherwise match on the retrofitted entity_id column.
      const account = entity.virtual
        ? floatAccounts[0] || null
        : floatAccounts.find((a) => a.entity_id === entity.id) || null;

      if (!account) {
        return { entity, account: null, currency: entity.currency, currentCash: 0, closing: 0 };
      }

      const accountBills = bills.filter((b) => b.account_id === account.id);
      const accountDeposits = deposits.filter((d) => d.account_id === account.id);
      const currency = entity.currency || account.currency;

      const currentCash = computeCurrentBalance({
        startingFloat: account.starting_float,
        floatAsOfDate: account.float_as_of_date,
        deposits: accountDeposits,
        bills: accountBills,
      });

      const entitySnapshots = snapshotsForEntity(snapshots, entity);
      const payrollEvents = payrollForecastEvents({ snapshots: entitySnapshots });
      const forecast = buildForecast({
        startingFloat: account.starting_float,
        floatAsOfDate: account.float_as_of_date,
        deposits: accountDeposits,
        bills: accountBills,
        extraEvents: payrollEvents,
      });
      const closing = forecastSummary(forecast).closing;

      return { entity, account, currency, currentCash, closing };
    });
  }, [entities, floatAccounts, bills, deposits, snapshots]);

  // Per-currency subtotals of current cash only - NEVER summed across
  // currencies (no FX rates until Phase 3).
  const groupTotals = useMemo(() => {
    const totals = {};
    for (const row of rows) {
      if (!row.account) continue;
      totals[row.currency] = (totals[row.currency] || 0) + row.currentCash;
    }
    return totals;
  }, [rows]);

  if (entitiesLoading || loading) {
    return <div style={{ color: "#6b7c85", fontSize: 14 }}>Loading...</div>;
  }

  return (
    <>
      {error && <ErrorBanner text={error} />}

      <div style={{ fontSize: 14, fontWeight: 700, color: "#012E41", marginBottom: 12 }}>Group summary</div>

      {rows.length === 0 ? (
        <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,.06)", color: "#6b7c85", fontSize: 13.5, marginBottom: 20 }}>
          No entities found.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 16 }}>
          {rows.map(({ entity, account, currency, currentCash, closing }) => (
            <div key={entity.id || entity.code} style={{ background: "#fff", borderRadius: 12, padding: 18, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Building2 size={15} color="#2BA99F" />
                <div style={{ fontWeight: 600, color: "#012E41", fontSize: 14 }}>{entityDisplayName(entity)}</div>
              </div>
              <div style={{ fontSize: 11, color: "#8a99a0", marginBottom: 10 }}>{entity.currency}</div>
              {account ? (
                <>
                  <SummaryRow label="Current cash" value={formatCurrency(currentCash, currency)} strong />
                  <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 7, fontSize: 13 }}>
                    <span style={{ color: "#6b7c85" }}>Forecast closing (6mo)</span>
                    <span style={{ fontWeight: 600, color: closing < 0 ? "#B91C1C" : "#012E41" }}>{formatCurrency(closing, currency)}</span>
                  </div>
                </>
              ) : (
                <EmptyNote text="No float account yet" />
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#012E41", marginBottom: 4 }}>Group total</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#012E41" }}>
          {Object.keys(groupTotals).length === 0
            ? "-"
            : Object.entries(groupTotals)
                .map(([cur, amt]) => formatCurrency(amt, cur))
                .join(" · ")}
        </div>
        <div style={{ fontSize: 11.5, color: "#8a99a0", marginTop: 6 }}>Consolidated group total arrives with FX rates (Phase 3).</div>
      </div>
    </>
  );
}
