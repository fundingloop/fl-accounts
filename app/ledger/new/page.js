"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X, AlertTriangle } from "lucide-react";
import AppShell from "@/components/AppShell";
import LedgerTabs from "@/components/ledger/LedgerTabs";
import JournalLinesEditor, { emptyLine, newLineKey } from "@/components/ledger/JournalLinesEditor";
import { createClient } from "@/lib/supabase-browser";
import { useEntities } from "@/lib/useEntities";
import { isMissingSchemaError } from "@/lib/payrollSnapshots";
import { todayISO } from "@/lib/format";
import { postableAccounts, validateDraftJournal } from "@/lib/ledger";

function lineIsBlank(l) {
  return !l.account_id && !Number(l.debit) && !Number(l.credit);
}

function lineIsUsable(l) {
  const debit = Number(l.debit) || 0;
  const credit = Number(l.credit) || 0;
  return !!l.account_id && ((debit > 0 && credit === 0) || (credit > 0 && debit === 0));
}

function NewJournalInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const { currentEntity, allSelected, loading: entitiesLoading } = useEntities();

  const [loading, setLoading] = useState(!!editId);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [entityInfo, setEntityInfo] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({ journal_date: todayISO(), description: "", notes: "" });
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(null); // 'draft' | 'post' | null

  const canUseCurrentEntity = !allSelected && !!currentEntity?.id && !currentEntity?.virtual;

  // Create mode: entity comes from the switcher.
  useEffect(() => {
    if (editId) return;
    if (canUseCurrentEntity) setEntityInfo(currentEntity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, canUseCurrentEntity, currentEntity?.id]);

  // Edit mode: load the existing draft + its lines, and resolve its entity
  // (which may differ from whatever the switcher currently has selected).
  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      const supabase = createClient();
      const { data: journal, error: jErr } = await supabase
        .from("fin_journals")
        .select("*")
        .eq("id", editId)
        .maybeSingle();

      if (cancelled) return;
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
      if (!journal) {
        setError("Draft journal not found.");
        setLoading(false);
        return;
      }
      if (journal.status !== "draft") {
        setError("Only draft journals can be edited.");
        setLoading(false);
        return;
      }

      const [entityRes, linesRes] = await Promise.all([
        supabase.from("fin_entities").select("*").eq("id", journal.entity_id).maybeSingle(),
        supabase.from("fin_journal_lines").select("*").eq("journal_id", editId).order("line_no", { ascending: true }),
      ]);
      if (cancelled) return;

      if (entityRes.error) {
        setError(entityRes.error.message);
        setLoading(false);
        return;
      }
      if (linesRes.error) {
        setError(linesRes.error.message);
        setLoading(false);
        return;
      }

      setEntityInfo(entityRes.data);
      setForm({
        journal_date: journal.journal_date,
        description: journal.description || "",
        notes: journal.notes || "",
      });
      const loadedLines = (linesRes.data || []).map((l) => ({
        key: newLineKey(),
        account_id: l.account_id,
        memo: l.memo || "",
        debit: Number(l.debit) > 0 ? String(l.debit) : "",
        credit: Number(l.credit) > 0 ? String(l.credit) : "",
      }));
      setLines(loadedLines.length > 0 ? loadedLines : [emptyLine(), emptyLine()]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [editId]);

  // Postable accounts for whichever entity this journal belongs to.
  useEffect(() => {
    if (!entityInfo?.id) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error: err } = await supabase
        .from("fin_accounts")
        .select("*")
        .eq("entity_id", entityInfo.id)
        .order("code", { ascending: true });
      if (cancelled) return;
      if (err && isMissingSchemaError(err)) {
        setSchemaMissing(true);
        setAccounts([]);
        return;
      }
      if (err) {
        setError(err.message);
        return;
      }
      setAccounts(data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [entityInfo?.id]);

  const accountOptions = useMemo(() => postableAccounts(accounts), [accounts]);

  const normalizedLines = useMemo(
    () =>
      lines
        .filter((l) => !lineIsBlank(l))
        .map((l, idx) => ({
          line_no: idx + 1,
          account_id: l.account_id,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          currency: entityInfo?.currency || "",
          memo: l.memo.trim() || null,
        })),
    [lines, entityInfo?.currency]
  );

  const issues = useMemo(() => {
    if (!entityInfo) return [];
    return validateDraftJournal({
      journal: {
        entity_id: entityInfo.id,
        journal_date: form.journal_date,
        description: form.description,
        currency: entityInfo.currency,
      },
      lines: normalizedLines,
      accounts,
    });
  }, [entityInfo, form, normalizedLines, accounts]);

  const saveDraft = async () => {
    setError("");
    if (!form.description.trim()) {
      setError("Description is required.");
      return null;
    }
    if (!form.journal_date) {
      setError("Journal date is required.");
      return null;
    }
    const badLines = lines.filter((l) => !lineIsBlank(l) && !lineIsUsable(l));
    if (badLines.length > 0) {
      setError("Each line needs an account and either a debit or a credit (not both, not zero).");
      return null;
    }

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const headerPayload = {
      entity_id: entityInfo.id,
      journal_date: form.journal_date,
      description: form.description.trim(),
      currency: entityInfo.currency,
      notes: form.notes.trim() || null,
    };

    let journalId = editId;
    if (editId) {
      const { error: err } = await supabase.from("fin_journals").update(headerPayload).eq("id", editId);
      if (err) {
        setError(err.message);
        return null;
      }
      const { error: delErr } = await supabase.from("fin_journal_lines").delete().eq("journal_id", editId);
      if (delErr) {
        setError(delErr.message);
        return null;
      }
    } else {
      const { data: inserted, error: err } = await supabase
        .from("fin_journals")
        .insert({ ...headerPayload, created_by: user?.id || null })
        .select("id")
        .single();
      if (err) {
        setError(err.message);
        return null;
      }
      journalId = inserted.id;
    }

    if (normalizedLines.length > 0) {
      const linesPayload = normalizedLines.map((l) => ({ ...l, journal_id: journalId }));
      const { error: linesErr } = await supabase.from("fin_journal_lines").insert(linesPayload);
      if (linesErr) {
        setError(linesErr.message);
        return null;
      }
    }

    return journalId;
  };

  const handleSaveDraft = async () => {
    setSaving("draft");
    const journalId = await saveDraft();
    setSaving(null);
    if (journalId) router.push(`/ledger/${journalId}`);
  };

  const handleSaveAndPost = async () => {
    setSaving("post");
    const journalId = await saveDraft();
    if (!journalId) {
      setSaving(null);
      return;
    }
    try {
      const res = await fetch("/api/ledger/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journal_id: journalId }),
      });
      const body = await res.json().catch(() => ({}));
      setSaving(null);
      if (!res.ok) {
        // Honest failure: the draft was already saved above and stays as a
        // draft. Land on its detail page with the posting error surfaced.
        router.push(`/ledger/${journalId}?postError=${encodeURIComponent(body?.error || "Could not post the journal.")}`);
        return;
      }
      router.push(`/ledger/${journalId}`);
    } catch {
      setSaving(null);
      router.push(`/ledger/${journalId}?postError=${encodeURIComponent("Could not reach the server. The draft has been saved.")}`);
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

  if (!editId && entitiesLoading) {
    return (
      <AppShell>
        <LedgerTabs />
        <div style={{ padding: 24, color: "#6b7c85", fontSize: 13.5 }}>Loading...</div>
      </AppShell>
    );
  }

  if (!editId && !canUseCurrentEntity) {
    return (
      <AppShell>
        <LedgerTabs />
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
          Select a single entity from the switcher to create a manual journal.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ marginBottom: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#012E41", margin: 0 }}>
          {editId ? "Edit journal draft" : "New manual journal"}
        </h1>
        <p style={{ fontSize: 13, color: "#6b7c85", margin: "4px 0 0" }}>
          {entityInfo ? `${entityInfo.legal_name || entityInfo.trading_name || entityInfo.code} - ${entityInfo.currency}` : " "}
        </p>
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
      ) : (
        <>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
              <Field label="Date" required>
                <input required type="date" value={form.journal_date} onChange={(e) => setForm({ ...form, journal_date: e.target.value })} style={inputStyle} />
              </Field>
              <Field label="Currency">
                <input disabled value={entityInfo?.currency || ""} style={{ ...inputStyle, background: "#f2f4f5", color: "#8a99a0" }} />
              </Field>
              <Field label="Description" required grow>
                <input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={inputStyle} />
              </Field>
              <Field label="Notes" grow>
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={inputStyle} />
              </Field>
            </div>
          </div>

          <div style={{ background: "#fff", borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#012E41", marginBottom: 14 }}>Lines</div>
            <JournalLinesEditor lines={lines} onChange={setLines} accounts={accountOptions} currency={entityInfo?.currency} />
          </div>

          {issues.length > 0 && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12.5 }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>This journal isn&apos;t ready to post yet:</div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {issues.map((issue, i) => <li key={i}>{issue}</li>)}
                </ul>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={handleSaveDraft}
              disabled={!!saving}
              style={{ background: "#f2f4f5", color: "#012E41", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13.5, fontWeight: 600, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}
            >
              {saving === "draft" ? "Saving..." : "Save draft"}
            </button>
            <button
              onClick={handleSaveAndPost}
              disabled={!!saving}
              style={{ background: "#012E41", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13.5, fontWeight: 600, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}
            >
              {saving === "post" ? "Posting..." : "Save & post"}
            </button>
            <button
              type="button"
              onClick={() => router.push(editId ? `/ledger/${editId}` : "/ledger")}
              disabled={!!saving}
              style={{ background: "none", color: "#6b7c85", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13.5, fontWeight: 600, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </AppShell>
  );
}

export default function NewJournalPage() {
  return (
    <Suspense fallback={null}>
      <NewJournalInner />
    </Suspense>
  );
}

function Field({ label, required, children, grow }) {
  return (
    <label style={{ display: "block", gridColumn: grow ? "span 2" : undefined }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334", marginBottom: 5 }}>
        {label}{required && <span style={{ color: "#B91C1C" }}> *</span>}
      </span>
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%", padding: "8px 10px", border: "1px solid #d7dee1", borderRadius: 7, fontSize: 13, fontFamily: "inherit", outline: "none",
};
