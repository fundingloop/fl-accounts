// Pure helpers for the fin_accounts / fin_journals / fin_journal_lines
// general ledger (double-entry). No Supabase imports - unit-testable in
// isolation, same pattern as lib/banking.js and lib/entities.js. The
// underlying tables come from a migration
// (fl-crm/supabase/migrations/20260711240000_fin_ledger.sql) that may not
// be applied yet; ledgerSchemaMissing() wraps isMissingSchemaError() from
// lib/payrollSnapshots.js, the same "not live yet" detection every other
// fl-accounts module uses.
//
// Money math: Supabase returns numeric columns as strings. Every sum here
// goes through toCents() and is added in integer cents, then converted back
// to currency units at the end - this avoids the float drift that summing
// "0.1" + "0.2" style decimal strings directly would introduce.

import { isMissingSchemaError } from "./payrollSnapshots";

// ACCOUNT_TYPES - ordered array of the 8 chart-of-accounts types, matching
// fin_accounts.account_type's CHECK constraint and display order.
export const ACCOUNT_TYPES = [
  { value: "asset", label: "Assets", normalBalance: "debit" },
  { value: "liability", label: "Liabilities", normalBalance: "credit" },
  { value: "equity", label: "Equity", normalBalance: "credit" },
  { value: "income", label: "Income", normalBalance: "credit" },
  { value: "cost_of_sales", label: "Cost of sales", normalBalance: "debit" },
  { value: "expense", label: "Expenses", normalBalance: "debit" },
  { value: "other_income", label: "Other income", normalBalance: "credit" },
  { value: "other_expense", label: "Other expense", normalBalance: "debit" },
];

const ACCOUNT_TYPE_BY_VALUE = new Map(ACCOUNT_TYPES.map((t) => [t.value, t]));

// accountTypeLabel(type) -> the friendly label for an account_type value.
// Unknown/null values fall back to the raw value (or "" for null/undefined)
// rather than throwing.
export function accountTypeLabel(type) {
  const found = ACCOUNT_TYPE_BY_VALUE.get(type);
  if (found) return found.label;
  return type || "";
}

// normalBalanceForType(type) -> the default normal_balance ('debit' or
// 'credit') for an account_type, used to pre-fill the chart-of-accounts
// form. Unknown/null types default to 'debit' rather than throwing.
export function normalBalanceForType(type) {
  const found = ACCOUNT_TYPE_BY_VALUE.get(type);
  return found ? found.normalBalance : "debit";
}

// SOURCE_TYPE_LABELS - friendly labels for fin_journals.source_type. Only
// 'manual' and 'reversal' are produced by this milestone; the rest reserve
// the vocabulary for future posting modules and get a title-cased fallback.
export const SOURCE_TYPE_LABELS = {
  manual: "Manual",
  reversal: "Reversal",
  bill: "Bill",
  payroll: "Payroll",
  revenue: "Revenue",
  transfer: "Transfer",
  deposit: "Deposit",
  rebaseline: "Rebaseline",
  opening_balance: "Opening balance",
  system: "System",
};

// sourceTypeLabel(type) -> the friendly label for a source_type value.
// Unknown/null values are title-cased word-by-word rather than thrown on.
export function sourceTypeLabel(type) {
  if (SOURCE_TYPE_LABELS[type]) return SOURCE_TYPE_LABELS[type];
  if (!type) return "";
  return String(type)
    .split("_")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

// toCents(value) -> integer cents for a currency-unit value. Number()
// coerces Supabase's numeric-as-string values; NaN (unparsable input, e.g.
// null/undefined/"") becomes 0 rather than throwing or propagating NaN.
export function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

// journalTotals(lines) -> { debits, credits, difference, balanced }. Sums
// in integer cents (cents-safe against float drift, e.g. 0.1 + 0.2), then
// converts back to currency units. balanced is true only when debits ==
// credits AND the total is > 0 (an all-zero journal is not "balanced").
export function journalTotals(lines) {
  let debitCents = 0;
  let creditCents = 0;
  for (const line of lines || []) {
    if (!line) continue;
    debitCents += toCents(line.debit);
    creditCents += toCents(line.credit);
  }
  const debits = debitCents / 100;
  const credits = creditCents / 100;
  const difference = (debitCents - creditCents) / 100;
  const balanced = debitCents === creditCents && debitCents > 0;
  return { debits, credits, difference, balanced };
}

// postableAccounts(accounts) -> active AND is_postable accounts, sorted by
// code. Null-safe; never mutates the input array.
export function postableAccounts(accounts) {
  if (!accounts) return [];
  return accounts
    .filter((a) => a && a.status === "active" && a.is_postable)
    .slice()
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

// accountsByType(accounts) -> a Map keyed by ACCOUNT_TYPES value, in that
// order, each holding the accounts of that type sorted with active
// accounts first, then by code, with a child account placed immediately
// after its parent (single-level indent - a child's own children are not
// further nested). Every ACCOUNT_TYPES key is present, even if empty, so
// callers can render a full grouped list without extra existence checks.
// Null-safe; never mutates the input array.
export function accountsByType(accounts) {
  const rows = accounts || [];
  const byType = new Map(ACCOUNT_TYPES.map((t) => [t.value, []]));

  const grouped = new Map();
  for (const type of ACCOUNT_TYPES) grouped.set(type.value, []);
  for (const account of rows) {
    if (!account) continue;
    const bucket = grouped.get(account.account_type);
    if (bucket) bucket.push(account);
  }

  const sortKey = (a) => [a.status === "active" ? 0 : 1, String(a.code)];
  const compare = (a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    return ka[1].localeCompare(kb[1]);
  };

  for (const type of ACCOUNT_TYPES) {
    const list = grouped.get(type.value) || [];
    const byId = new Map(list.map((a) => [a.id, a]));
    const topLevel = list.filter((a) => !a.parent_id || !byId.has(a.parent_id));
    const childrenByParent = new Map();
    for (const a of list) {
      if (a.parent_id && byId.has(a.parent_id)) {
        if (!childrenByParent.has(a.parent_id)) childrenByParent.set(a.parent_id, []);
        childrenByParent.get(a.parent_id).push(a);
      }
    }
    topLevel.sort(compare);
    const ordered = [];
    for (const parent of topLevel) {
      ordered.push(parent);
      const children = (childrenByParent.get(parent.id) || []).slice().sort(compare);
      ordered.push(...children);
    }
    byType.set(type.value, ordered);
  }

  return byType;
}

// validateDraftJournal({ journal, lines, accounts }) -> an array of error
// strings; empty means the journal is postable. Mirrors the server-side
// posting RPC's validation so a user sees the same failures before
// spending a round trip. `accounts` is the full account list for the
// journal's entity (active or archived, postable or not) so unknown/
// archived/non-postable accounts can be distinguished.
export function validateDraftJournal({ journal, lines, accounts } = {}) {
  const errors = [];
  const journalRow = journal || {};
  const lineRows = lines || [];
  const accountById = new Map((accounts || []).filter(Boolean).map((a) => [a.id, a]));

  if (!journalRow.journal_date) errors.push("Journal date is required.");
  if (!journalRow.description || !String(journalRow.description).trim()) {
    errors.push("Description is required.");
  }

  if (lineRows.length === 0) {
    errors.push("A journal needs at least one debit and one credit line.");
  }

  lineRows.forEach((line, index) => {
    const n = index + 1;
    if (!line || !line.account_id) {
      errors.push(`Line ${n}: an account is required.`);
      return;
    }
    const account = accountById.get(line.account_id);
    if (!account) {
      errors.push(`Line ${n}: unknown account.`);
      return;
    }
    if (account.status !== "active") {
      errors.push(`Line ${n}: account ${account.code} is not active.`);
    }
    if (!account.is_postable) {
      errors.push(`Line ${n}: account ${account.code} is not postable.`);
    }
    if (
      journalRow.entity_id &&
      account.entity_id &&
      account.entity_id !== journalRow.entity_id
    ) {
      errors.push(`Line ${n}: account ${account.code} belongs to a different entity.`);
    }

    const debitCents = toCents(line.debit);
    const creditCents = toCents(line.credit);
    if (debitCents > 0 && creditCents > 0) {
      errors.push(`Line ${n}: cannot have both a debit and a credit amount.`);
    } else if (debitCents === 0 && creditCents === 0) {
      errors.push(`Line ${n}: amount must be greater than zero.`);
    }

    if (journalRow.currency && line.currency && line.currency !== journalRow.currency) {
      errors.push(`Line ${n}: currency ${line.currency} does not match the journal currency ${journalRow.currency}.`);
    }
    if (account.currency && line.currency && account.currency !== line.currency) {
      errors.push(`Line ${n}: currency does not match account ${account.code}'s currency ${account.currency}.`);
    }
  });

  const totals = journalTotals(lineRows);
  if (lineRows.length > 0 && !totals.balanced) {
    errors.push(`Journal does not balance: debits ${totals.debits.toFixed(2)} vs credits ${totals.credits.toFixed(2)}.`);
  }

  return errors;
}

// buildReversalLines(lines) -> a new array with debit/credit swapped on
// every line; line_no, account_id, currency, bank_account_id and memo are
// preserved. Applying this twice restores the original amounts (a reversal
// of a reversal). Null-safe; never mutates the input array/objects.
export function buildReversalLines(lines) {
  return (lines || []).filter(Boolean).map((line) => ({
    line_no: line.line_no,
    account_id: line.account_id,
    debit: line.credit,
    credit: line.debit,
    currency: line.currency,
    bank_account_id: line.bank_account_id,
    memo: line.memo,
  }));
}

// journalStatusInfo(journal, { reversedBy } = {}) -> { label, tone } for the
// status badge. `reversedBy` (optional) is truthy when some other posted
// journal reverses this one - "reversed" is derived, not a stored status.
export function journalStatusInfo(journal, { reversedBy } = {}) {
  const status = journal?.status;
  if (status === "draft") return { label: "Draft", tone: "amber" };
  if (status === "posted") {
    if (reversedBy) return { label: "Reversed", tone: "gray" };
    return { label: "Posted", tone: "green" };
  }
  return { label: "Unknown", tone: "gray" };
}

// nextJournalActions(journal, { reversedBy } = {}) -> the subset of
// ['edit','post','delete','reverse'] available for a journal: a draft can
// be edited/posted/deleted; a posted, not-yet-reversed journal can be
// reversed; a reversed journal (or anything else) offers no actions.
export function nextJournalActions(journal, { reversedBy } = {}) {
  const status = journal?.status;
  if (status === "draft") return ["edit", "post", "delete"];
  if (status === "posted") {
    return reversedBy ? [] : ["reverse"];
  }
  return [];
}

// formatJournalNo(no) -> '#00012' style formatting; a null/undefined
// journal_no (a draft that has never been posted) formats as 'Draft'.
export function formatJournalNo(no) {
  if (no === null || no === undefined || no === "") return "Draft";
  const n = Number(no);
  if (!Number.isFinite(n)) return "Draft";
  return "#" + String(n).padStart(5, "0");
}

// filterJournals(rows, { status, sourceType, dateFrom, dateTo, query }) ->
// the pure in-memory filter behind the Journal Entries list. `status` may
// be 'draft' | 'posted' | 'reversed' (reversed is derived from
// row.reversed_by, which callers must attach beforehand) or falsy/'all' for
// no filter. `query` matches description, the formatted journal number
// (both '#00012' and bare '12' forms) and notes, case-insensitively.
// Null-safe; never mutates the input array.
export function filterJournals(rows, { status, sourceType, dateFrom, dateTo, query } = {}) {
  let result = (rows || []).filter(Boolean);

  if (status && status !== "all") {
    result = result.filter((row) => {
      if (status === "reversed") return row.status === "posted" && !!row.reversed_by;
      if (status === "posted") return row.status === "posted" && !row.reversed_by;
      return row.status === status;
    });
  }

  if (sourceType && sourceType !== "all") {
    result = result.filter((row) => row.source_type === sourceType);
  }

  if (dateFrom) {
    result = result.filter((row) => row.journal_date && row.journal_date >= dateFrom);
  }
  if (dateTo) {
    result = result.filter((row) => row.journal_date && row.journal_date <= dateTo);
  }

  const q = (query || "").trim().toLowerCase();
  if (q) {
    result = result.filter((row) => {
      const description = String(row.description || "").toLowerCase();
      const notes = String(row.notes || "").toLowerCase();
      const formatted = formatJournalNo(row.journal_no).toLowerCase();
      const bareNo = row.journal_no !== null && row.journal_no !== undefined
        ? String(row.journal_no)
        : "";
      return (
        description.includes(q) ||
        notes.includes(q) ||
        formatted.includes(q) ||
        bareNo.includes(q)
      );
    });
  }

  return result;
}

// ledgerSchemaMissing(err) -> true when a fin_accounts/fin_journals/
// fin_journal_lines query failed because the migration is not applied yet,
// rather than a genuine error. Thin re-export of isMissingSchemaError() so
// every page imports schema-missing detection from lib/ledger.js.
export function ledgerSchemaMissing(err) {
  return isMissingSchemaError(err);
}
