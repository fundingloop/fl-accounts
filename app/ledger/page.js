"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Search } from "lucide-react";
import AppShell from "@/components/AppShell";
import LedgerTabs from "@/components/ledger/LedgerTabs";
import StatusBadge from "@/components/ledger/StatusBadge";
import { createClient } from "@/lib/supabase-browser";
import { useEntities } from "@/lib/useEntities";
import { isMissingSchemaError } from "@/lib/payrollSnapshots";
import { entityDisplayName } from "@/lib/entities";
import { formatCurrency, formatDate } from "@/lib/format";
import { formatJournalNo, filterJournals, journalTotals, journalStatusInfo, sourceTypeLabel } from "@/lib/ledger";

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "posted", label: "Posted" },
  { value: "reversed", label: "Reversed" },
];

const emptyFilters = {
  status: "all",
  sourceType: "all",
  dateFrom: "",
  dateTo: "",
  query: "",
};

export default function LedgerPage() {
  const router = useRouter();
  const { entities, currentEntity, allSelected } = useEntities();
  const [journals, setJournals] = useState([]);
  const [reversedByMap, setReversedByMap] = useState(new Map());
  const [lineTotalsById, setLineTotalsById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);

  const load = async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();

    let journalsQuery = supabase
      .from("fin_journals")
      .select("*")
      .order("journal_date", { ascending: false })
      .order("created_at", { ascending: false });
    let reversalQuery = supabase
      .from("fin_journals")
      .select("id, reverses_journal_id")
      .not("reverses_journal_id", "is", null);
    if (!allSelected && currentEntity?.id) {
      journalsQuery = journalsQuery.eq("entity_id", currentEntity.id);
      reversalQuery = reversalQuery.eq("entity_id", currentEntity.id);
    }

    const [journalsRes, reversalRes] = await Promise.all([journalsQuery, reversalQuery]);

    if ((journalsRes.error && isMissingSchemaError(journalsRes.error)) || (reversalRes.error && isMissingSchemaError(reversalRes.error))) {
      setSchemaMissing(true);
      setJournals([]);
      setReversedByMap(new Map());
      setLineTotalsById({});
      setLoading(false);
      return;
    }
    const firstError = journalsRes.error || reversalRes.error;
    if (firstError) {
      setError(firstError.message);
      setJournals([]);
      setLoading(false);
      return;
    }

    setSchemaMissing(false);
    const journalRows = journalsRes.data || [];
    setJournals(journalRows);

    const map = new Map();
    for (const row of reversalRes.data || []) {
      if (row.reverses_journal_id) map.set(row.reverses_journal_id, row.id);
    }
    setReversedByMap(map);

    const journalIds = journalRows.map((j) => j.id);
    if (journalIds.length > 0) {
      const { data: linesData, error: linesErr } = await supabase
        .from("fin_journal_lines")
        .select("journal_id, debit, credit")
        .in("journal_id", journalIds);
      if (!linesErr && linesData) {
        const grouped = {};
        for (const line of linesData) {
          if (!grouped[line.journal_id]) grouped[line.journal_id] = [];
          grouped[line.journal_id].push(line);
        }
        const totals = {};
        for (const [journalId, lines] of Object.entries(grouped)) {
          totals[journalId] = journalTotals(lines);
        }
        setLineTotalsById(totals);
      } else {
        setLineTotalsById({});
      }
    } else {
      setLineTotalsById({});
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSelected, currentEntity?.id]);

  const sourceTypeOptions = useMemo(() => {
    const set = new Set(journals.map((j) => j.source_type).filter(Boolean));
    return Array.from(set).sort();
  }, [journals]);

  const entitiesById = useMemo(() => {
    const map = {};
    for (const e of entities) map[e.id] = e;
    return map;
  }, [entities]);

  // filterJournals is a pure function over rows + { status, sourceType,
  // dateFrom, dateTo, query }. It derives "reversed" from a row.reversed_by
  // field (truthy = the id of the journal that reverses this one), which
  // isn't a real fin_journals column - it's attached here from the
  // reversed-by map before rows are handed to the filter. 'all' sentinels
  // are translated to undefined so an unset filter doesn't exclude everything.
  const filteredJournals = useMemo(() => {
    const viewRows = journals.map((j) => ({
      ...j,
      reversed_by: reversedByMap.get(j.id) || null,
    }));
    return filterJournals(viewRows, {
      status: filters.status === "all" ? undefined : filters.status,
      sourceType: filters.sourceType === "all" ? undefined : filters.sourceType,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      query: filters.query || undefined,
    });
  }, [journals, reversedByMap, filters]);

  const showEntityColumn = allSelected;
  const canCreate = !allSelected && currentEntity?.id && !currentEntity?.virtual;
  const createHint = allSelected
    ? "Select one entity to create a manual journal."
    : currentEntity?.virtual
      ? "The entity registry migration has not been applied yet."
      : "";

  return (
    <AppShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#012E41", margin: 0 }}>Ledger</h1>
          <p style={{ fontSize: 13, color: "#6b7c85", margin: "4px 0 0" }}>Double-entry journal entries and the chart of accounts</p>
        </div>
        {!schemaMissing && (
          <button
            onClick={() => canCreate && router.push("/ledger/new")}
            disabled={!canCreate}
            title={createHint}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: canCreate ? "#2BA99F" : "#c9d3d6", color: "#fff", border: "none",
              borderRadius: 8, padding: "10px 16px", fontSize: 13.5, fontWeight: 600,
              cursor: canCreate ? "pointer" : "not-allowed", fontFamily: "inherit",
            }}
          >
            <Plus size={16} /> New journal
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
          The ledger migration has not been applied yet.
        </div>
      ) : (
        <>
          <LedgerTabs />

          <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,.06)", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <Field label="Status">
              <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} style={inputStyle}>
                {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Source">
              <select value={filters.sourceType} onChange={(e) => setFilters({ ...filters, sourceType: e.target.value })} style={inputStyle}>
                <option value="all">All sources</option>
                {sourceTypeOptions.map((s) => <option key={s} value={s}>{sourceTypeLabel(s)}</option>)}
              </select>
            </Field>
            <Field label="From">
              <input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="To">
              <input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Search" grow>
              <div style={{ position: "relative" }}>
                <Search size={14} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#8a99a0" }} />
                <input
                  value={filters.query}
                  onChange={(e) => setFilters({ ...filters, query: e.target.value })}
                  placeholder="Description, notes, or journal number"
                  style={{ ...inputStyle, paddingLeft: 30 }}
                />
              </div>
            </Field>
            {(filters.status !== "all" || filters.sourceType !== "all" || filters.dateFrom || filters.dateTo || filters.query) && (
              <button
                type="button"
                onClick={() => setFilters(emptyFilters)}
                style={{ border: "none", background: "none", color: "#2BA99F", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "8px 4px", fontFamily: "inherit" }}
              >
                Clear filters
              </button>
            )}
          </div>

          <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.06)", overflow: "hidden" }}>
            {loading ? (
              <div style={{ padding: 24, color: "#6b7c85", fontSize: 13.5 }}>Loading journals...</div>
            ) : filteredJournals.length === 0 ? (
              <div style={{ padding: 24, color: "#8a99a0", fontSize: 13.5 }}>
                {journals.length === 0 ? "No journal entries yet." : "No journal entries match these filters."}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: "#f6f8f9", textAlign: "left" }}>
                      <Th>No</Th>
                      <Th>Date</Th>
                      <Th>Description</Th>
                      <Th>Source</Th>
                      {showEntityColumn && <Th>Entity</Th>}
                      <Th align="right">Debits</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJournals.map((row) => {
                      const info = journalStatusInfo(row, { reversedBy: row.reversed_by });
                      const totals = lineTotalsById[row.id] || { debits: 0 };
                      return (
                        <tr
                          key={row.id}
                          onClick={() => router.push(`/ledger/${row.id}`)}
                          style={{ borderTop: "1px solid #f0f2f3", cursor: "pointer" }}
                        >
                          <Td style={{ fontFamily: "monospace" }}>{formatJournalNo(row.journal_no)}</Td>
                          <Td>{formatDate(row.journal_date)}</Td>
                          <Td style={{ whiteSpace: "normal", maxWidth: 320 }}>{row.description}</Td>
                          <Td>{sourceTypeLabel(row.source_type)}</Td>
                          {showEntityColumn && <Td>{entityDisplayName(entitiesById[row.entity_id])}</Td>}
                          <Td align="right" style={{ fontWeight: 600 }}>{formatCurrency(totals.debits, row.currency)}</Td>
                          <Td><StatusBadge label={info.label} tone={info.tone} /></Td>
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

function Field({ label, children, grow }) {
  return (
    <label style={{ display: "block", flex: grow ? "1 1 220px" : "0 0 auto", minWidth: grow ? 200 : undefined }}>
      <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#6b7c85", marginBottom: 5, textTransform: "uppercase", letterSpacing: ".03em" }}>
        {label}
      </span>
      {children}
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
  padding: "8px 10px", border: "1px solid #d7dee1", borderRadius: 7, fontSize: 13, fontFamily: "inherit", outline: "none", width: "100%",
};
