// Pure helpers for the fin_entities registry (multi-entity foundation).
// No Supabase imports - unit-testable in isolation, same pattern as
// lib/payrollSnapshots.js. The entities table comes from a migration that
// may not be applied yet; lib/useEntities.js is what handles that via
// isMissingSchemaError() + virtualEntityFromFloatAccount() below.

// entityDisplayName(entity) -> the name to show in the UI: trading name
// first (what the business is known as day to day), falling back to the
// legal name, then the machine code. Never throws on a null/partial entity.
export function entityDisplayName(entity) {
  if (!entity) return "";
  return entity.trading_name || entity.legal_name || entity.code || "";
}

// entityInitials(entity) -> up to 2 uppercase initials of the display name,
// for the logo-placeholder avatar (e.g. "Funding Loop Nepal" -> "FL",
// "acme" -> "AC"). Empty/whitespace-only names return "".
export function entityInitials(entity) {
  const name = entityDisplayName(entity).trim();
  if (!name) return "";
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

// virtualEntityFromFloatAccount(account) -> the pre-migration fallback used
// when fin_entities does not exist yet: a single synthetic "entity" built
// from the one float_accounts row the app already knows about (v1 was
// Nepal-only). `virtual: true` marks it as not a real fin_entities row so
// callers can disable entity-management UI on it. Null-safe.
export function virtualEntityFromFloatAccount(account) {
  return {
    id: null,
    code: "fl-nepal",
    legal_name: account?.name || "Nepal",
    trading_name: null,
    country_code: "NP",
    currency: account?.currency || "NPR",
    status: "active",
    virtual: true,
  };
}

// activeEntities(rows) -> non-archived entities, sorted by display name
// (case-insensitive). Null-safe; never mutates the input array.
export function activeEntities(rows) {
  if (!rows) return [];
  return rows
    .filter((row) => row && row.status !== "archived")
    .slice()
    .sort((a, b) =>
      entityDisplayName(a).localeCompare(entityDisplayName(b), undefined, { sensitivity: "base" })
    );
}

// maskAccountNumber(value) -> masks every character but the last 4 with a
// bullet, e.g. "123456789" -> "•••••6789". Short values (<=4 chars) are
// masked entirely down to a sensible minimum length so a short number
// doesn't leak its full length/content; null/undefined/"" -> "••••". Never
// throws.
export function maskAccountNumber(value) {
  const s = value === null || value === undefined ? "" : String(value).trim();
  if (s.length === 0) return "••••";
  if (s.length <= 4) return "••••";
  const last4 = s.slice(-4);
  const maskedLength = s.length - 4;
  return "•".repeat(maskedLength) + last4;
}
