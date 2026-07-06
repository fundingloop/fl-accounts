"use client";

import { useEffect, useMemo, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { AlertTriangle, TrendingDown, Clock, Wallet } from "lucide-react";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase-browser";
import { useFloatAccount } from "@/lib/useFloatAccount";
import { buildForecast, outstandingTotal, overdueSummary, dueSoonSummary } from "@/lib/forecast";
import { formatCurrency, formatDate } from "@/lib/format";

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

export default function DashboardPage() {
  const { account, loading: accountLoading, error: accountError } = useFloatAccount();
  const [bills, setBills] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!account?.id) return;
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

  const forecast = useMemo(() => {
    if (!account) return null;
    return buildForecast({
      startingFloat: account.starting_float,
      floatAsOfDate: account.float_as_of_date,
      deposits,
      bills,
    });
  }, [account, bills, deposits]);

  const outstanding = useMemo(() => outstandingTotal(bills), [bills]);
  const overdue = useMemo(() => overdueSummary(bills), [bills]);
  const dueSoon = useMemo(() => dueSoonSummary(bills), [bills]);
  const currency = account?.currency || "NPR";
  const dipsBelowZero = forecast && forecast.lowest.balance < 0;

  return (
    <AppShell>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#012E41", margin: 0 }}>Dashboard</h1>
        <p style={{ fontSize: 13, color: "#6b7c85", margin: "4px 0 0" }}>
          {account ? account.name : "Loading account..."} float and 6-month cashflow forecast
        </p>
      </div>

      {accountError && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13 }}>
          {accountError}
        </div>
      )}

      {(accountLoading || loading) && !account ? (
        <div style={{ color: "#6b7c85", fontSize: 14 }}>Loading...</div>
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
          <div style={{ background: "#fff", borderRadius: 12, padding: "20px 20px 8px", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
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
          </div>
        </>
      )}
    </AppShell>
  );
}
