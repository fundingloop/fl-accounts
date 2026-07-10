"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { X, Pencil, Send, Trash2, RotateCcw } from "lucide-react";
import AppShell from "@/components/AppShell";
import LedgerTabs from "@/components/ledger/LedgerTabs";
import StatusBadge from "@/components/ledger/StatusBadge";
import { createClient } from "@/lib/supabase-browser";
import { isMissingSchemaError } from "@/lib/payrollSnapshots";
import { entityDisplayName } from "@/lib/entities";
import { formatCurrency, formatDate, todayISO } from "@/lib/format";
import { formatJournalNo, journalTotals, journalStatusInfo, nextJournalActions, sourceTypeLabel } from "@/lib/ledger";

function JournalDetailInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const journalId = params?.id;

  const [journal, setJournal] = useState(null);
  const [entity, setEntity] = useState(null);
  const [lines, setLines] = useState([]);
  const [reversesJournal, setReversesJournal] = useState(null);
  const [reversedByJournal, setReversedByJournal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reverseFormOpen, setReverseFormOpen] = useState(false);
  const [reverseForm, setReverseForm] = useState({ journal_date: todayISO(), description: "" });

  useEffect(() => {
    const initial = searchParams.get("postError");
    if (initial) setError(initial);
    // Only meant to seed the error once, on arrival from /ledger/new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setLoading(true);
    const supabase = createClient();

    const { data: journalRow, error: jErr } = await supabase
      .from("fin_journals")
      .select("*")
      .eq("id", journalId)
      .maybeSingle();

    if (jErr && isMissingSchemaError(jErr)) {
      setSchemaMissing(true);
      setLoading(false);
      return;
    }
    if (jErr) {
      setError(jErr.message);
      setLoading(false);
      return;
    }
    if (!journalRow) {
      setError("Journal not found.");
      setJournal(null);
      setLoading(false);
      return;
    }
    setSchemaMissing(false);
    setJournal(journalRow);

    const [entityRes, linesRes, reversesRes, reversedByRes] = await Promise.all([
      supabase.from("fin_entities").select("*").eq("id", journalRow.entity_id).maybeSingle(),
      supabase
        .from("fin_journal_lines")
        .select("*, account:fin_accounts(id, code, name), bank_account:fin_bank_accounts(id, nickname, account_name)")
        .eq("journal_id", journalId)
        .order("line_no", { ascending: true }),
      journalRow.reverses_journal_id
        ? supabase.from("fin_journals").select("id, journal_no, description").eq("id", journalRow.reverses_journal_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from("fin_journals").select("id, journal_no, description").eq("reverses_journal_id", journalId).maybeSingle(),
    ]);

    setEntity(entityRes.data || null);
    setLines(linesRes.data || []);
    setReversesJournal(reversesRes.data || null);
    setReversedByJournal(reversedByRes.data || null);
    setLoading(false);
  };

  useEffect(() => {
    if (journalId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journalId]);

  const totals = useMemo(() => journalTotals(lines), [lines]);
  const statusInfo = useMemo(
    () => (journal ? journalStatusInfo(journal, { reversedBy: reversedByJournal?.id || null }) : null),
    [journal, reversedByJournal]
  );
  const actions = useMemo(
    () => (journal ? nextJournalActions(journal, { reversedBy: reversedByJournal?.id || null }) : []),
    [journal, reversedByJournal]
  );

  const doPost = async () => {
    if (!window.confirm("Post this journal? Posted journals are permanent - corrections are made with a reversing journal.")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ledger/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journal_id: journalId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || "Could not post the journal.");
        setBusy(false);
        return;
      }
      await load();
    } catch {
      setError("Could not reach the server. The journal was not posted.");
    }
    setBusy(false);
  };

  const doDelete = async () => {
    if (!window.confirm("Delete this draft journal? This cannot be undone.")) return;
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.from("fin_journals").delete().eq("id", journalId);
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    router.push("/ledger");
  };

  const doReverse = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ledger/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          journal_id: journalId,
          journal_date: reverseForm.journal_date || undefined,
          description: reverseForm.description.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || "Could not reverse the journal.");
        setBusy(false);
        return;
      }
      router.push(`/ledger/${body.reversal_journal_id}`);
    } catch {
      setError("Could not reach the server. The journal was not reversed.");
      setBusy(false);
    }
  };

  if (schemaMissing) {
    return (
      <AppShell>
        <LedgerTabs />
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
          The ledger migration has not been applied yet.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ marginBottom: 6 }}>
        <Link href="/ledger" style={{ fontSize: 12.5, color: "#2BA99F", textDecoration: "none", fontWeight: 600 }}>
          &larr; Journal entries
        </Link>
      </div>

      <LedgerTabs />

      {error && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{error}</span>
          <button onClick={() => setError("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#B91C1C" }}><X size={14} /></button>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, color: "#6b7c85", fontSize: 13.5 }}>Loading...</div>
      ) : !journal ? (
        <div style={{ padding: 24, color: "#8a99a0", fontSize: 13.5 }}>Journal not found.</div>
      ) : (
        <>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#012E41", fontFamily: "monospace" }}>{formatJournalNo(journal.journal_no)}</div>
                <div style={{ fontSize: 13.5, color: "#334", marginTop: 4 }}>{journal.description}</div>
              </div>
              {statusInfo && <StatusBadge label={statusInfo.label} tone={statusInfo.tone} />}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, fontSize: 13 }}>
              <InfoField label="Date" value={formatDate(journal.journal_date)} />
              <InfoField label="Entity" value={entityDisplayName(entity)} />
              <InfoField label="Currency" value={journal.currency} />
              <InfoField label="Source" value={sourceTypeLabel(journal.source_type)} />
              <InfoField label="Posted by" value={journal.posted_by_name || "-"} />
              <InfoField label="Posted at" value={journal.posted_at ? formatDate(journal.posted_at) : "-"} />
            </div>

            {(reversesJournal || reversedByJournal) && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #f0f2f3", display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
                {reversesJournal && (
                  <div>
                    Reverses{" "}
                    <Link href={`/ledger/${reversesJournal.id}`} style={{ color: "#2BA99F", fontWeight: 600, textDecoration: "none" }}>
                      {formatJournalNo(reversesJournal.journal_no)}: {reversesJournal.description}
                    </Link>
                  </div>
                )}
                {reversedByJournal && (
                  <div>
                    Reversed by{" "}
                    <Link href={`/ledger/${reversedByJournal.id}`} style={{ color: "#2BA99F", fontWeight: 600, textDecoration: "none" }}>
                      {formatJournalNo(reversedByJournal.journal_no)}: {reversedByJournal.description}
                    </Link>
                  </div>
                )}
              </div>
            )}

            {journal.notes && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #f0f2f3", fontSize: 12.5, color: "#6b7c85" }}>
                <strong style={{ color: "#334" }}>Notes: </strong>{journal.notes}
              </div>
            )}
          </div>

          <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.06)", overflow: "hidden", marginBottom: 16 }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f6f8f9", textAlign: "left" }}>
                    <Th>Account</Th>
                    <Th>Memo</Th>
                    <Th>Bank account</Th>
                    <Th align="right">Debit</Th>
                    <Th align="right">Credit</Th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <Td colSpan={5} style={{ color: "#8a99a0" }}>No lines.</Td>
                    </tr>
                  ) : (
                    lines.map((line) => (
                      <tr key={line.id} style={{ borderTop: "1px solid #f0f2f3" }}>
                        <Td>
                          {line.account ? (
                            <>
                              <span style={{ fontFamily: "monospace", color: "#8a99a0", marginRight: 6 }}>{line.account.code}</span>
                              {line.account.name}
                            </>
                          ) : "-"}
                        </Td>
                        <Td>{line.memo || "-"}</Td>
                        <Td>{line.bank_account ? (line.bank_account.nickname || line.bank_account.account_name) : "-"}</Td>
                        <Td align="right">{Number(line.debit) > 0 ? formatCurrency(line.debit, journal.currency) : ""}</Td>
                        <Td align="right">{Number(line.credit) > 0 ? formatCurrency(line.credit, journal.currency) : ""}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
                {lines.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: "2px solid #e5e9ea", fontWeight: 700 }}>
                      <Td colSpan={3}>Total</Td>
                      <Td align="right">{formatCurrency(totals.debits, journal.currency)}</Td>
                      <Td align="right">{formatCurrency(totals.credits, journal.currency)}</Td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {actions.length > 0 && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
              {actions.includes("edit") && (
                <ActionButton icon={Pencil} label="Edit" onClick={() => router.push(`/ledger/new?edit=${journalId}`)} disabled={busy} />
              )}
              {actions.includes("post") && (
                <ActionButton icon={Send} label="Post" onClick={doPost} disabled={busy} primary />
              )}
              {actions.includes("delete") && (
                <ActionButton icon={Trash2} label="Delete" onClick={doDelete} disabled={busy} danger />
              )}
              {actions.includes("reverse") && !reverseFormOpen && (
                <ActionButton icon={RotateCcw} label="Reverse" onClick={() => setReverseFormOpen(true)} disabled={busy} />
              )}
            </div>
          )}

          {reverseFormOpen && (
            <div style={{ background: "#fff", borderRadius: 12, padding: 18, marginTop: 14, boxShadow: "0 1px 3px rgba(0,0,0,.06)", maxWidth: 480 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: "#012E41", marginBottom: 12 }}>Reverse this journal</div>
              <div style={{ display: "grid", gap: 12, marginBottom: 14 }}>
                <label style={{ display: "block" }}>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334", marginBottom: 5 }}>Reversal date</span>
                  <input
                    type="date"
                    value={reverseForm.journal_date}
                    onChange={(e) => setReverseForm({ ...reverseForm, journal_date: e.target.value })}
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: "block" }}>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334", marginBottom: 5 }}>Description</span>
                  <input
                    value={reverseForm.description}
                    onChange={(e) => setReverseForm({ ...reverseForm, description: e.target.value })}
                    placeholder={`Reversal of journal ${formatJournalNo(journal.journal_no)}: ${journal.description}`}
                    style={inputStyle}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={doReverse}
                  disabled={busy}
                  style={{ background: "#012E41", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", fontFamily: "inherit" }}
                >
                  {busy ? "Reversing..." : "Confirm reversal"}
                </button>
                <button
                  type="button"
                  onClick={() => setReverseFormOpen(false)}
                  disabled={busy}
                  style={{ background: "#f2f4f5", color: "#334", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

function InfoField({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#8a99a0", textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 3 }}>{label}</div>
      <div style={{ color: "#334" }}>{value}</div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, disabled, primary, danger }) {
  const bg = primary ? "#012E41" : danger ? "#fff" : "#f2f4f5";
  const color = primary ? "#fff" : danger ? "#B91C1C" : "#334";
  const border = danger ? "1px solid #FECACA" : "none";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: 6, background: bg, color, border, borderRadius: 8,
        padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: disabled ? "default" : "pointer", fontFamily: "inherit",
      }}
    >
      <Icon size={14} /> {label}
    </button>
  );
}

function Th({ children, align }) {
  return (
    <th style={{ padding: "10px 14px", fontSize: 11.5, fontWeight: 700, color: "#6b7c85", textTransform: "uppercase", letterSpacing: ".03em", textAlign: align || "left" }}>
      {children}
    </th>
  );
}

function Td({ children, align, style, colSpan }) {
  return (
    <td colSpan={colSpan} style={{ padding: "12px 14px", textAlign: align || "left", color: "#334", ...style }}>
      {children}
    </td>
  );
}

const inputStyle = {
  width: "100%", padding: "8px 10px", border: "1px solid #d7dee1", borderRadius: 7, fontSize: 13, fontFamily: "inherit", outline: "none",
};

export default function JournalDetailPage() {
  return (
    <Suspense fallback={null}>
      <JournalDetailInner />
    </Suspense>
  );
}
