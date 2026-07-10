// Helpers for the finance-side payroll run snapshot mirror (payroll_run_snapshots).
// Pure + dependency-free - no Supabase imports - so these are unit-testable in
// isolation. The snapshot table/RPC come from a migration that may not yet be
// applied in production; isMissingSchemaError() is how the page tells "the
// migration isn't live yet" apart from a real error.

// isMissingSchemaError(err) -> true when the failure looks like the table/RPC
// does not exist yet (unapplied migration), rather than a genuine error.
// Mirrors the pattern the sibling fl-people app uses to detect the same thing.
export function isMissingSchemaError(err) {
  const message = err?.message;
  if (!message) return false;
  return /could not find|does not exist|schema cache/i.test(message);
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// periodLabel(year, month) -> "Jan 2026" style label. Falls back to a plain
// "year-month" string for an out-of-range month rather than throwing.
export function periodLabel(year, month) {
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) return `${year}-${month}`;
  return `${MONTH_LABELS[m - 1]} ${year}`;
}

// latestSnapshot(rows) -> the row with the greatest (period_year, period_month),
// without assuming the input is already sorted. null for empty/nullish input.
export function latestSnapshot(rows) {
  if (!rows || rows.length === 0) return null;
  let latest = rows[0];
  for (const row of rows) {
    if (
      row.period_year > latest.period_year ||
      (row.period_year === latest.period_year && row.period_month > latest.period_month)
    ) {
      latest = row;
    }
  }
  return latest;
}

// snapshotsForEntity(rows, entity) -> the snapshot rows belonging to one
// entity. `entity` is the useEntities() currentEntity: null/undefined means
// "All entities" was selected, so every row is returned unchanged. Otherwise
// a row is kept when its entity_id matches entity.id (post entity_id
// migration), falling back to entity_code (which ALWAYS exists, even before
// that migration) when the row has no entity_id yet. Null-safe; never
// mutates the input array.
export function snapshotsForEntity(rows, entity) {
  if (!rows) return [];
  if (entity === null || entity === undefined) return rows.slice();
  return rows.filter((row) => {
    if (!row) return false;
    if (row.entity_id !== null && row.entity_id !== undefined) {
      return row.entity_id === entity.id;
    }
    return row.entity_code === entity.code;
  });
}

// csvField(value) -> RFC-4180 escaped field. Null/undefined become "".
function csvField(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CSV_HEADER = [
  "period", "period_start", "period_end", "pay_date", "currency", "employees",
  "total_gross", "total_ssf_employee", "total_ssf_employer", "total_ssf_payable",
  "total_tds", "total_net", "total_cash_cost", "finalised_at", "finalised_by",
];

// snapshotCsv(rows) -> CSV string for the history export, oldest period first.
export function snapshotCsv(rows) {
  const sorted = [...(rows || [])].sort((a, b) => {
    if (a.period_year !== b.period_year) return a.period_year - b.period_year;
    return a.period_month - b.period_month;
  });

  const lines = [CSV_HEADER.join(",")];
  for (const r of sorted) {
    lines.push([
      periodLabel(r.period_year, r.period_month),
      r.period_start,
      r.period_end,
      r.pay_date,
      r.currency,
      r.employees_count,
      r.total_gross,
      r.total_ssf_employee,
      r.total_ssf_employer,
      r.total_ssf_payable,
      r.total_tds,
      r.total_net,
      r.total_cash_cost,
      r.finalised_at,
      r.finalised_by_name,
    ].map(csvField).join(","));
  }
  return lines.join("\n") + "\n";
}
