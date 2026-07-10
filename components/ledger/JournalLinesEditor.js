"use client";

import { Plus, Trash2 } from "lucide-react";
import { journalTotals } from "@/lib/ledger";
import { formatCurrency } from "@/lib/format";

let keySeq = 0;
// newLineKey() -> a stable React key for a freshly added draft line. Using a
// module-level counter (rather than the array index) keeps focus/inputs
// correct when a row in the middle of the list is removed.
export function newLineKey() {
  keySeq += 1;
  return `new-${Date.now()}-${keySeq}`;
}

// emptyLine() -> a fresh blank line row for the editor's local state shape:
// { key, account_id, memo, debit, credit }. debit/credit are the raw string
// inputs (not yet coerced to numbers) so an empty field can stay empty
// rather than snapping to "0" while typing.
export function emptyLine() {
  return { key: newLineKey(), account_id: "", memo: "", debit: "", credit: "" };
}

// JournalLinesEditor - the line-item grid for a manual journal draft.
// `accounts` should already be filtered to postable accounts for the
// journal's entity (lib/ledger.js's postableAccounts()). `currency` is
// display-only (the journal's locked currency, shown in the totals footer).
export default function JournalLinesEditor({ lines, onChange, accounts, currency, disabled }) {
  const totals = journalTotals(lines);

  const updateLine = (key, patch) => {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const setDebit = (key, value) => {
    updateLine(key, { debit: value, credit: value.trim() ? "" : lines.find((l) => l.key === key)?.credit || "" });
  };

  const setCredit = (key, value) => {
    updateLine(key, { credit: value, debit: value.trim() ? "" : lines.find((l) => l.key === key)?.debit || "" });
  };

  const addLine = () => onChange([...lines, emptyLine()]);
  const removeLine = (key) => onChange(lines.filter((l) => l.key !== key));

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f6f8f9", textAlign: "left" }}>
              <th style={thStyle}>Account</th>
              <th style={thStyle}>Memo</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Debit</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Credit</th>
              <th style={{ ...thStyle, width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} style={{ borderTop: "1px solid #f0f2f3" }}>
                <td style={tdStyle}>
                  <select
                    disabled={disabled}
                    value={line.account_id}
                    onChange={(e) => updateLine(line.key, { account_id: e.target.value })}
                    style={inputStyle}
                  >
                    <option value="">Select account...</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} - {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={tdStyle}>
                  <input
                    disabled={disabled}
                    value={line.memo}
                    onChange={(e) => updateLine(line.key, { memo: e.target.value })}
                    style={inputStyle}
                    placeholder="Optional"
                  />
                </td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <input
                    disabled={disabled}
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.debit}
                    onChange={(e) => setDebit(line.key, e.target.value)}
                    style={{ ...inputStyle, textAlign: "right" }}
                  />
                </td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <input
                    disabled={disabled}
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.credit}
                    onChange={(e) => setCredit(line.key, e.target.value)}
                    style={{ ...inputStyle, textAlign: "right" }}
                  />
                </td>
                <td style={{ ...tdStyle, textAlign: "center" }}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => removeLine(line.key)}
                    style={{ border: "none", background: "none", cursor: disabled ? "default" : "pointer", color: "#B91C1C", padding: 4 }}
                    title="Remove line"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={addLine}
        style={{
          display: "flex", alignItems: "center", gap: 6, marginTop: 10, background: "none", border: "1px dashed #d7dee1",
          borderRadius: 7, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, color: "#2BA99F",
          cursor: disabled ? "default" : "pointer", fontFamily: "inherit",
        }}
      >
        <Plus size={14} /> Add line
      </button>

      <div
        style={{
          display: "flex", justifyContent: "flex-end", gap: 24, marginTop: 16, padding: "12px 16px",
          background: totals.balanced ? "#ECFDF5" : "#FFFBEB", borderRadius: 8, fontSize: 13,
        }}
      >
        <div>
          <span style={{ color: "#6b7c85" }}>Debits: </span>
          <strong>{formatCurrency(totals.debits, currency)}</strong>
        </div>
        <div>
          <span style={{ color: "#6b7c85" }}>Credits: </span>
          <strong>{formatCurrency(totals.credits, currency)}</strong>
        </div>
        <div>
          <span style={{ color: "#6b7c85" }}>Difference: </span>
          <strong style={{ color: totals.balanced ? "#047857" : "#92400E" }}>
            {formatCurrency(totals.difference, currency)}
          </strong>
        </div>
        <div style={{ fontWeight: 700, color: totals.balanced ? "#047857" : "#92400E" }}>
          {totals.balanced ? "Balanced" : "Not balanced"}
        </div>
      </div>
    </div>
  );
}

const thStyle = {
  padding: "8px 10px", fontSize: 11.5, fontWeight: 700, color: "#6b7c85", textTransform: "uppercase", letterSpacing: ".03em",
};

const tdStyle = {
  padding: "6px 10px",
};

const inputStyle = {
  width: "100%", padding: "7px 9px", border: "1px solid #d7dee1", borderRadius: 6, fontSize: 13, fontFamily: "inherit", outline: "none",
};
