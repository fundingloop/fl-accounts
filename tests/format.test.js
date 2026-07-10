import { describe, it, expect } from "vitest";
import { formatCurrency, formatDate } from "../lib/format.js";

describe("formatCurrency", () => {
  it("formats an NPR value with no decimals and thousands grouping", () => {
    const out = formatCurrency(1234567, "NPR");
    expect(out).not.toMatch(/\./);
    expect(out).toMatch(/,/);
    expect(out).toMatch(/1,234,567/);
  });

  it("falls back to a plain 'CODE amount' string for an invalid currency code, without throwing", () => {
    expect(() => formatCurrency(1234, "NOTACODE")).not.toThrow();
    expect(formatCurrency(1234, "NOTACODE")).toBe("NOTACODE 1,234");
  });

  it("treats null/NaN amounts as 0 rather than throwing", () => {
    expect(() => formatCurrency(null)).not.toThrow();
    expect(() => formatCurrency(NaN)).not.toThrow();
    expect(formatCurrency(null)).toBe(formatCurrency(0));
    expect(formatCurrency(NaN)).toBe(formatCurrency(0));
  });
});

describe("formatDate", () => {
  it("formats a plain date string as en-AU, UTC", () => {
    // Reference computed the same way formatDate builds its UTC date, so this
    // assertion tracks the runtime's actual en-AU/UTC output rather than a
    // hardcoded string that could drift between ICU versions.
    const expected = new Date(Date.UTC(2026, 6, 11)).toLocaleDateString("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    expect(formatDate("2026-07-11")).toBe(expected);
    expect(formatDate("2026-07-11")).toContain("11");
    expect(formatDate("2026-07-11")).toContain("2026");
  });

  it("returns '-' for falsy input", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDate(undefined)).toBe("-");
    expect(formatDate("")).toBe("-");
  });

  it("uses only the date part of an ISO datetime string", () => {
    expect(formatDate("2026-07-11T15:30:00Z")).toBe(formatDate("2026-07-11"));
  });
});
