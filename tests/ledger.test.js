// Unit tests for lib/ledger.js - the pure helpers behind the general ledger
// (fin_accounts / fin_journals / fin_journal_lines). DB-enforced behaviour
// (posted-journal immutability, RLS, RPC actor/role gating, the deferred
// balance backstop) is verified via the migration's own POST-APPLY
// VERIFICATION block
// (fl-crm/supabase/migrations/20260711240000_fin_ledger.sql), consistent
// with every prior fl-accounts milestone - it is not re-verified here.
import { describe, it, expect } from "vitest";
import {
  ACCOUNT_TYPES,
  accountTypeLabel,
  normalBalanceForType,
  SOURCE_TYPE_LABELS,
  sourceTypeLabel,
  toCents,
  journalTotals,
  validateDraftJournal,
  buildReversalLines,
  journalStatusInfo,
  nextJournalActions,
  formatJournalNo,
  filterJournals,
  accountsByType,
  postableAccounts,
  ledgerSchemaMissing,
} from "../lib/ledger.js";

describe("ACCOUNT_TYPES / accountTypeLabel / normalBalanceForType", () => {
  it("lists all 8 account types in order with the expected labels and normal balances", () => {
    expect(ACCOUNT_TYPES.map((t) => t.value)).toEqual([
      "asset", "liability", "equity", "income", "cost_of_sales",
      "expense", "other_income", "other_expense",
    ]);
    expect(ACCOUNT_TYPES.map((t) => t.label)).toEqual([
      "Assets", "Liabilities", "Equity", "Income", "Cost of sales",
      "Expenses", "Other income", "Other expense",
    ]);
  });

  it("accountTypeLabel maps every known type to its label", () => {
    expect(accountTypeLabel("asset")).toBe("Assets");
    expect(accountTypeLabel("cost_of_sales")).toBe("Cost of sales");
    expect(accountTypeLabel("other_expense")).toBe("Other expense");
  });

  it("accountTypeLabel falls back to the raw value or empty string", () => {
    expect(accountTypeLabel("bogus")).toBe("bogus");
    expect(accountTypeLabel(null)).toBe("");
    expect(accountTypeLabel(undefined)).toBe("");
  });

  it("normalBalanceForType returns the correct default per type", () => {
    expect(normalBalanceForType("asset")).toBe("debit");
    expect(normalBalanceForType("liability")).toBe("credit");
    expect(normalBalanceForType("equity")).toBe("credit");
    expect(normalBalanceForType("income")).toBe("credit");
    expect(normalBalanceForType("cost_of_sales")).toBe("debit");
    expect(normalBalanceForType("expense")).toBe("debit");
    expect(normalBalanceForType("other_income")).toBe("credit");
    expect(normalBalanceForType("other_expense")).toBe("debit");
  });

  it("normalBalanceForType defaults to debit for unknown/null types", () => {
    expect(normalBalanceForType("bogus")).toBe("debit");
    expect(normalBalanceForType(null)).toBe("debit");
  });
});

describe("SOURCE_TYPE_LABELS / sourceTypeLabel", () => {
  it("maps manual and reversal to their friendly labels", () => {
    expect(sourceTypeLabel("manual")).toBe("Manual");
    expect(sourceTypeLabel("reversal")).toBe("Reversal");
  });

  it("title-cases the reserved future source types", () => {
    expect(sourceTypeLabel("opening_balance")).toBe("Opening balance");
    expect(sourceTypeLabel("bill")).toBe("Bill");
    expect(sourceTypeLabel("payroll")).toBe("Payroll");
  });

  it("title-cases an unknown value rather than throwing", () => {
    expect(sourceTypeLabel("some_new_thing")).toBe("Some New Thing");
  });

  it("returns empty string for null/undefined", () => {
    expect(sourceTypeLabel(null)).toBe("");
    expect(sourceTypeLabel(undefined)).toBe("");
  });
});

describe("toCents", () => {
  it("converts a currency-unit number to integer cents", () => {
    expect(toCents(10)).toBe(1000);
    expect(toCents(10.5)).toBe(1050);
    expect(toCents(0.1)).toBe(10);
  });

  it("coerces a numeric string (as Supabase returns numerics)", () => {
    expect(toCents("100.25")).toBe(10025);
  });

  it("returns 0 for NaN/unparsable input", () => {
    expect(toCents("abc")).toBe(0);
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
    expect(toCents("")).toBe(0);
  });
});

describe("journalTotals", () => {
  it("reports a balanced journal", () => {
    const totals = journalTotals([
      { debit: 100, credit: 0 },
      { debit: 0, credit: 100 },
    ]);
    expect(totals).toEqual({ debits: 100, credits: 100, difference: 0, balanced: true });
  });

  it("reports an imbalanced journal", () => {
    const totals = journalTotals([
      { debit: 100, credit: 0 },
      { debit: 0, credit: 80 },
    ]);
    expect(totals.debits).toBe(100);
    expect(totals.credits).toBe(80);
    expect(totals.difference).toBe(20);
    expect(totals.balanced).toBe(false);
  });

  it("is cents-safe against float drift (0.1 + 0.2 vs 0.3)", () => {
    const totals = journalTotals([
      { debit: 0.1, credit: 0 },
      { debit: 0.2, credit: 0 },
      { debit: 0, credit: 0.3 },
    ]);
    expect(totals.debits).toBe(0.3);
    expect(totals.credits).toBe(0.3);
    expect(totals.difference).toBe(0);
    expect(totals.balanced).toBe(true);
  });

  it("does not consider an all-zero journal balanced", () => {
    const totals = journalTotals([
      { debit: 0, credit: 0 },
      { debit: 0, credit: 0 },
    ]);
    expect(totals.debits).toBe(0);
    expect(totals.credits).toBe(0);
    expect(totals.balanced).toBe(false);
  });

  it("handles string inputs from Supabase numerics", () => {
    const totals = journalTotals([
      { debit: "50.00", credit: "0" },
      { debit: "0", credit: "50.00" },
    ]);
    expect(totals).toEqual({ debits: 50, credits: 50, difference: 0, balanced: true });
  });

  it("is null-safe for missing/empty lines", () => {
    expect(journalTotals([])).toEqual({ debits: 0, credits: 0, difference: 0, balanced: false });
    expect(journalTotals(null)).toEqual({ debits: 0, credits: 0, difference: 0, balanced: false });
    expect(journalTotals(undefined)).toEqual({ debits: 0, credits: 0, difference: 0, balanced: false });
  });
});

describe("validateDraftJournal", () => {
  const entityId = "entity-1";
  const otherEntityId = "entity-2";

  const cashAccount = {
    id: "acct-cash", entity_id: entityId, code: "1000", status: "active",
    is_postable: true, currency: null,
  };
  const revenueAccount = {
    id: "acct-rev", entity_id: entityId, code: "4000", status: "active",
    is_postable: true, currency: null,
  };
  const archivedAccount = {
    id: "acct-archived", entity_id: entityId, code: "9000", status: "archived",
    is_postable: true, currency: null,
  };
  const headerAccount = {
    id: "acct-header", entity_id: entityId, code: "1", status: "active",
    is_postable: false, currency: null,
  };
  const otherEntityAccount = {
    id: "acct-other-entity", entity_id: otherEntityId, code: "1000", status: "active",
    is_postable: true, currency: null,
  };
  const usdOnlyAccount = {
    id: "acct-usd", entity_id: entityId, code: "1010", status: "active",
    is_postable: true, currency: "USD",
  };

  const accounts = [cashAccount, revenueAccount, archivedAccount, headerAccount, otherEntityAccount, usdOnlyAccount];

  const baseJournal = {
    entity_id: entityId,
    journal_date: "2026-07-11",
    description: "Opening balance",
    currency: "AUD",
  };

  function balancedLines() {
    return [
      { line_no: 1, account_id: cashAccount.id, debit: 100, credit: 0, currency: "AUD" },
      { line_no: 2, account_id: revenueAccount.id, debit: 0, credit: 100, currency: "AUD" },
    ];
  }

  it("has no errors on a valid, balanced journal", () => {
    const errors = validateDraftJournal({ journal: baseJournal, lines: balancedLines(), accounts });
    expect(errors).toEqual([]);
  });

  it("requires a description", () => {
    const errors = validateDraftJournal({
      journal: { ...baseJournal, description: "  " },
      lines: balancedLines(),
      accounts,
    });
    expect(errors).toContain("Description is required.");
  });

  it("requires a journal date", () => {
    const errors = validateDraftJournal({
      journal: { ...baseJournal, journal_date: null },
      lines: balancedLines(),
      accounts,
    });
    expect(errors).toContain("Journal date is required.");
  });

  it("requires at least one line", () => {
    const errors = validateDraftJournal({ journal: baseJournal, lines: [], accounts });
    expect(errors).toContain("A journal needs at least one debit and one credit line.");
  });

  it("rejects an unknown account", () => {
    const errors = validateDraftJournal({
      journal: baseJournal,
      lines: [
        { line_no: 1, account_id: "does-not-exist", debit: 100, credit: 0, currency: "AUD" },
        { line_no: 2, account_id: revenueAccount.id, debit: 0, credit: 100, currency: "AUD" },
      ],
      accounts,
    });
    expect(errors.some((e) => /unknown account/i.test(e))).toBe(true);
  });

  it("rejects an archived account", () => {
    const errors = validateDraftJournal({
      journal: baseJournal,
      lines: [
        { line_no: 1, account_id: archivedAccount.id, debit: 100, credit: 0, currency: "AUD" },
        { line_no: 2, account_id: revenueAccount.id, debit: 0, credit: 100, currency: "AUD" },
      ],
      accounts,
    });
    expect(errors.some((e) => /not active/i.test(e))).toBe(true);
  });

  it("rejects a non-postable (header) account", () => {
    const errors = validateDraftJournal({
      journal: baseJournal,
      lines: [
        { line_no: 1, account_id: headerAccount.id, debit: 100, credit: 0, currency: "AUD" },
        { line_no: 2, account_id: revenueAccount.id, debit: 0, credit: 100, currency: "AUD" },
      ],
      accounts,
    });
    expect(errors.some((e) => /not postable/i.test(e))).toBe(true);
  });

  it("rejects a cross-entity account", () => {
    const errors = validateDraftJournal({
      journal: baseJournal,
      lines: [
        { line_no: 1, account_id: otherEntityAccount.id, debit: 100, credit: 0, currency: "AUD" },
        { line_no: 2, account_id: revenueAccount.id, debit: 0, credit: 100, currency: "AUD" },
      ],
      accounts,
    });
    expect(errors.some((e) => /different entity/i.test(e))).toBe(true);
  });

  it("rejects a zero-amount line", () => {
    const errors = validateDraftJournal({
      journal: baseJournal,
      lines: [
        { line_no: 1, account_id: cashAccount.id, debit: 0, credit: 0, currency: "AUD" },
        { line_no: 2, account_id: revenueAccount.id, debit: 0, credit: 100, currency: "AUD" },
      ],
      accounts,
    });
    expect(errors.some((e) => /greater than zero/i.test(e))).toBe(true);
  });

  it("rejects a line with both debit and credit set", () => {
    const errors = validateDraftJournal({
      journal: baseJournal,
      lines: [
        { line_no: 1, account_id: cashAccount.id, debit: 50, credit: 50, currency: "AUD" },
        { line_no: 2, account_id: revenueAccount.id, debit: 0, credit: 100, currency: "AUD" },
      ],
      accounts,
    });
    expect(errors.some((e) => /both a debit and a credit/i.test(e))).toBe(true);
  });

  it("rejects a line currency mismatch against the journal currency", () => {
    const errors = validateDraftJournal({
      journal: baseJournal,
      lines: [
        { line_no: 1, account_id: cashAccount.id, debit: 100, credit: 0, currency: "USD" },
        { line_no: 2, account_id: revenueAccount.id, debit: 0, credit: 100, currency: "AUD" },
      ],
      accounts,
    });
    expect(errors.some((e) => /does not match the journal currency/i.test(e))).toBe(true);
  });

  it("rejects an account-currency mismatch", () => {
    // usdOnlyAccount is pinned to currency: "USD". The line and the journal
    // both say AUD (so the line-vs-journal currency check passes cleanly),
    // isolating the account.currency vs line.currency check.
    const errors = validateDraftJournal({
      journal: baseJournal,
      lines: [
        { line_no: 1, account_id: usdOnlyAccount.id, debit: 100, credit: 0, currency: "AUD" },
        { line_no: 2, account_id: revenueAccount.id, debit: 0, credit: 100, currency: "AUD" },
      ],
      accounts,
    });
    expect(errors.some((e) => /account 1010's currency/i.test(e))).toBe(true);
  });

  it("rejects an imbalanced journal", () => {
    const errors = validateDraftJournal({
      journal: baseJournal,
      lines: [
        { line_no: 1, account_id: cashAccount.id, debit: 100, credit: 0, currency: "AUD" },
        { line_no: 2, account_id: revenueAccount.id, debit: 0, credit: 80, currency: "AUD" },
      ],
      accounts,
    });
    expect(errors.some((e) => /does not balance/i.test(e))).toBe(true);
    expect(errors.some((e) => /100\.00/.test(e) && /80\.00/.test(e))).toBe(true);
  });
});

describe("buildReversalLines", () => {
  it("swaps debit/credit and preserves the other fields", () => {
    const lines = [
      { line_no: 1, account_id: "a1", debit: 100, credit: 0, currency: "AUD", bank_account_id: "b1", memo: "cash in" },
      { line_no: 2, account_id: "a2", debit: 0, credit: 100, currency: "AUD", bank_account_id: null, memo: "revenue" },
    ];
    const reversed = buildReversalLines(lines);
    expect(reversed).toEqual([
      { line_no: 1, account_id: "a1", debit: 0, credit: 100, currency: "AUD", bank_account_id: "b1", memo: "cash in" },
      { line_no: 2, account_id: "a2", debit: 100, credit: 0, currency: "AUD", bank_account_id: null, memo: "revenue" },
    ]);
  });

  it("a reversal of a reversal restores the original amounts", () => {
    const original = [
      { line_no: 1, account_id: "a1", debit: 100, credit: 0, currency: "AUD", bank_account_id: null, memo: null },
      { line_no: 2, account_id: "a2", debit: 0, credit: 100, currency: "AUD", bank_account_id: null, memo: null },
    ];
    const twiceReversed = buildReversalLines(buildReversalLines(original));
    expect(twiceReversed).toEqual(original);
  });

  it("is null-safe and does not mutate the input", () => {
    expect(buildReversalLines(null)).toEqual([]);
    expect(buildReversalLines(undefined)).toEqual([]);
    const lines = [{ line_no: 1, account_id: "a1", debit: 10, credit: 0, currency: "AUD" }];
    const copy = JSON.parse(JSON.stringify(lines));
    buildReversalLines(lines);
    expect(lines).toEqual(copy);
  });
});

describe("journalStatusInfo", () => {
  it("draft -> Draft/amber", () => {
    expect(journalStatusInfo({ status: "draft" })).toEqual({ label: "Draft", tone: "amber" });
  });

  it("posted, not reversed -> Posted/green", () => {
    expect(journalStatusInfo({ status: "posted" })).toEqual({ label: "Posted", tone: "green" });
    expect(journalStatusInfo({ status: "posted" }, { reversedBy: null })).toEqual({ label: "Posted", tone: "green" });
  });

  it("posted, reversed -> Reversed/gray", () => {
    expect(journalStatusInfo({ status: "posted" }, { reversedBy: "journal-2" })).toEqual({
      label: "Reversed", tone: "gray",
    });
  });
});

describe("nextJournalActions", () => {
  it("draft allows edit, post, delete", () => {
    expect(nextJournalActions({ status: "draft" })).toEqual(["edit", "post", "delete"]);
  });

  it("posted, not reversed allows reverse only", () => {
    expect(nextJournalActions({ status: "posted" })).toEqual(["reverse"]);
  });

  it("posted, reversed allows nothing", () => {
    expect(nextJournalActions({ status: "posted" }, { reversedBy: "journal-2" })).toEqual([]);
  });

  it("returns an empty array for an unknown status", () => {
    expect(nextJournalActions({ status: "bogus" })).toEqual([]);
    expect(nextJournalActions({})).toEqual([]);
  });
});

describe("formatJournalNo", () => {
  it("pads a journal number to 5 digits with a # prefix", () => {
    expect(formatJournalNo(12)).toBe("#00012");
    expect(formatJournalNo(1)).toBe("#00001");
    expect(formatJournalNo(123456)).toBe("#123456");
  });

  it("returns 'Draft' for null/undefined/empty (a never-posted draft)", () => {
    expect(formatJournalNo(null)).toBe("Draft");
    expect(formatJournalNo(undefined)).toBe("Draft");
    expect(formatJournalNo("")).toBe("Draft");
  });
});

describe("filterJournals", () => {
  const rows = [
    { id: "1", status: "draft", source_type: "manual", journal_date: "2026-07-01", description: "Rent accrual", journal_no: null, notes: null },
    { id: "2", status: "posted", source_type: "manual", journal_date: "2026-07-05", description: "Opening balances", journal_no: 12, notes: "Q3 setup", reversed_by: null },
    { id: "3", status: "posted", source_type: "reversal", journal_date: "2026-07-06", description: "Correcting entry", journal_no: 13, notes: null, reversed_by: null },
    { id: "4", status: "posted", source_type: "manual", journal_date: "2026-06-01", description: "Bank fees", journal_no: 5, notes: null, reversed_by: "3" },
  ];

  it("filters by status draft", () => {
    expect(filterJournals(rows, { status: "draft" }).map((r) => r.id)).toEqual(["1"]);
  });

  it("filters by status posted (excludes reversed)", () => {
    expect(filterJournals(rows, { status: "posted" }).map((r) => r.id)).toEqual(["2", "3"]);
  });

  it("filters by status reversed (derived from reversed_by)", () => {
    expect(filterJournals(rows, { status: "reversed" }).map((r) => r.id)).toEqual(["4"]);
  });

  it("filters by source_type", () => {
    expect(filterJournals(rows, { sourceType: "reversal" }).map((r) => r.id)).toEqual(["3"]);
  });

  it("filters by a date range", () => {
    const result = filterJournals(rows, { dateFrom: "2026-07-01", dateTo: "2026-07-05" });
    expect(result.map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("matches the free-text query against the description", () => {
    expect(filterJournals(rows, { query: "rent" }).map((r) => r.id)).toEqual(["1"]);
    expect(filterJournals(rows, { query: "OPENING" }).map((r) => r.id)).toEqual(["2"]);
  });

  it("matches the free-text query against notes", () => {
    expect(filterJournals(rows, { query: "q3 setup" }).map((r) => r.id)).toEqual(["2"]);
  });

  it("matches the free-text query against a '#00012'-style journal number", () => {
    expect(filterJournals(rows, { query: "#00012" }).map((r) => r.id)).toEqual(["2"]);
  });

  it("matches the free-text query against a bare journal number", () => {
    expect(filterJournals(rows, { query: "12" }).map((r) => r.id)).toEqual(["2"]);
  });

  it("combines multiple filters", () => {
    const result = filterJournals(rows, { status: "posted", sourceType: "manual", query: "opening" });
    expect(result.map((r) => r.id)).toEqual(["2"]);
  });

  it("is null-safe and returns everything when no filters are given", () => {
    expect(filterJournals(rows, {}).length).toBe(4);
    expect(filterJournals(null, {})).toEqual([]);
    expect(filterJournals(undefined)).toEqual([]);
  });
});

describe("postableAccounts", () => {
  const accounts = [
    { id: "a1", code: "2000", status: "active", is_postable: true },
    { id: "a2", code: "1000", status: "active", is_postable: true },
    { id: "a3", code: "1", status: "active", is_postable: false },
    { id: "a4", code: "9000", status: "archived", is_postable: true },
  ];

  it("keeps only active + postable accounts, sorted by code", () => {
    const result = postableAccounts(accounts).map((a) => a.id);
    expect(result).toEqual(["a2", "a1"]);
  });

  it("is null-safe and does not mutate the input", () => {
    expect(postableAccounts(null)).toEqual([]);
    expect(postableAccounts(undefined)).toEqual([]);
    const copy = [...accounts];
    postableAccounts(accounts);
    expect(accounts).toEqual(copy);
  });
});

describe("accountsByType", () => {
  const accounts = [
    { id: "p1", code: "1000", account_type: "asset", status: "active", parent_id: null },
    { id: "c1", code: "1010", account_type: "asset", status: "active", parent_id: "p1" },
    { id: "p2", code: "1100", account_type: "asset", status: "active", parent_id: null },
    { id: "archived1", code: "1200", account_type: "asset", status: "archived", parent_id: null },
    { id: "l1", code: "2000", account_type: "liability", status: "active", parent_id: null },
  ];

  it("has an entry for every ACCOUNT_TYPES value, in order, even when empty", () => {
    const grouped = accountsByType(accounts);
    expect([...grouped.keys()]).toEqual(ACCOUNT_TYPES.map((t) => t.value));
    expect(grouped.get("income")).toEqual([]);
  });

  it("sorts active accounts before archived, then by code, with a child directly after its parent", () => {
    const grouped = accountsByType(accounts);
    const assetIds = grouped.get("asset").map((a) => a.id);
    expect(assetIds).toEqual(["p1", "c1", "p2", "archived1"]);
  });

  it("groups a different type into its own bucket", () => {
    const grouped = accountsByType(accounts);
    expect(grouped.get("liability").map((a) => a.id)).toEqual(["l1"]);
  });

  it("is null-safe", () => {
    const grouped = accountsByType(null);
    expect([...grouped.keys()]).toEqual(ACCOUNT_TYPES.map((t) => t.value));
    for (const list of grouped.values()) expect(list).toEqual([]);
  });
});

describe("ledgerSchemaMissing", () => {
  it("recognises a missing-schema error message", () => {
    expect(ledgerSchemaMissing({ message: "Could not find the table 'public.fin_journals' in the schema cache" })).toBe(true);
    expect(ledgerSchemaMissing({ message: "relation \"fin_accounts\" does not exist" })).toBe(true);
  });

  it("returns false for an unrelated error", () => {
    expect(ledgerSchemaMissing({ message: "permission denied for table fin_journals" })).toBe(false);
  });

  it("is null-safe", () => {
    expect(ledgerSchemaMissing(null)).toBe(false);
    expect(ledgerSchemaMissing(undefined)).toBe(false);
    expect(ledgerSchemaMissing({})).toBe(false);
  });
});
