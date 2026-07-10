// Pure helpers for the fin_bank_accounts / fin_transfers workflow (multi-entity
// banking). No Supabase imports - unit-testable in isolation, same pattern as
// lib/entities.js and lib/payrollSnapshots.js. The underlying tables come from
// a migration that may not be applied yet; isMissingSchemaError() (imported
// from lib/payrollSnapshots.js by the pages) is how "not live yet" is told
// apart from a real error.

const ACCOUNT_TYPE_LABELS = {
  operating: "Operating",
  payroll: "Payroll",
  savings: "Savings",
  loan: "Loan",
  credit_card: "Credit card",
  other: "Other",
};

// bankAccountTypeLabel(type) -> a friendly label for a
// fin_bank_accounts.account_type value. Unknown/null values fall back to
// "Other" rather than throwing.
export function bankAccountTypeLabel(type) {
  return ACCOUNT_TYPE_LABELS[type] || "Other";
}

// transfersForEntity(rows, entityId) -> the transfers where the given entity
// is either the sender or the receiver, matching fin_transfers.from_entity_id
// / to_entity_id. entityId of null/undefined/"all" (the EntitySwitcher's
// "all entities" sentinel) returns every row, unfiltered. Null-safe; never
// mutates the input array.
export function transfersForEntity(rows, entityId) {
  if (!rows) return [];
  if (!entityId || entityId === "all") return rows.slice();
  return rows.filter(
    (row) => row && (row.from_entity_id === entityId || row.to_entity_id === entityId)
  );
}

// Matches the DB's fin_transfers_guard() status-transition rules:
//   planned -> in_transit | settled | cancelled
//   in_transit -> settled | cancelled
//   settled / cancelled are terminal (settled: fully locked; cancelled: only
//   deletable).
const TRANSFER_ACTIONS = {
  planned: ["mark_in_transit", "settle", "cancel", "delete"],
  in_transit: ["settle", "cancel"],
  settled: [],
  cancelled: ["delete"],
};

// nextTransferActions(status) -> the list of allowed row actions for a
// fin_transfers.status value. Unknown/null statuses get no actions rather
// than throwing.
export function nextTransferActions(status) {
  return TRANSFER_ACTIONS[status] || [];
}
