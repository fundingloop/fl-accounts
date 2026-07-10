const TONE_STYLES = {
  amber: { bg: "#FFFBEB", color: "#92400E" },
  green: { bg: "#ECFDF5", color: "#047857" },
  gray: { bg: "#F3F4F6", color: "#6B7280" },
};

// Small pill badge for a journal/account status. `tone` comes from
// lib/ledger.js's journalStatusInfo()/similar - unknown tones fall back to
// gray rather than throwing.
export default function StatusBadge({ label, tone }) {
  const style = TONE_STYLES[tone] || TONE_STYLES.gray;
  return (
    <span
      style={{
        background: style.bg,
        color: style.color,
        borderRadius: 20,
        padding: "3px 10px",
        fontSize: 11.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}
