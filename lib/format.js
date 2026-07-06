// Small display-formatting helpers shared by the dashboard/bills/float pages.
// v1 is single-currency (NPR), per the brief - no FX, no per-bill currency.

export function formatCurrency(amount, currency = "NPR") {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    // Unknown ISO code - fall back to a plain number with the code prefixed.
    return `${currency} ${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
}

export function formatDate(value) {
  if (!value) return "-";
  const s = String(value).slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return s;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
