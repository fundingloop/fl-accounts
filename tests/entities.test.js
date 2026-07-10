import { describe, it, expect } from "vitest";
import {
  entityDisplayName,
  entityInitials,
  virtualEntityFromFloatAccount,
  activeEntities,
  maskAccountNumber,
} from "../lib/entities.js";

describe("entityDisplayName", () => {
  it("prefers trading_name over legal_name and code", () => {
    expect(entityDisplayName({ trading_name: "Funding Loop", legal_name: "Funding Loop Pty Ltd", code: "fl-au" })).toBe("Funding Loop");
  });

  it("falls back to legal_name when trading_name is missing", () => {
    expect(entityDisplayName({ legal_name: "Funding Loop Nepal", code: "fl-nepal" })).toBe("Funding Loop Nepal");
  });

  it("falls back to code when both names are missing", () => {
    expect(entityDisplayName({ code: "fl-nepal" })).toBe("fl-nepal");
  });

  it("is safe for a null/undefined entity", () => {
    expect(entityDisplayName(null)).toBe("");
    expect(entityDisplayName(undefined)).toBe("");
  });

  it("treats empty-string names as absent", () => {
    expect(entityDisplayName({ trading_name: "", legal_name: "", code: "fl-au" })).toBe("fl-au");
  });
});

describe("entityInitials", () => {
  it("takes the first letter of the first two words for multi-word names", () => {
    expect(entityInitials({ trading_name: "Funding Loop" })).toBe("FL");
    expect(entityInitials({ legal_name: "Funding Loop Nepal" })).toBe("FL");
  });

  it("takes the first two letters of a single-word name", () => {
    expect(entityInitials({ trading_name: "acme" })).toBe("AC");
  });

  it("returns an empty string for a null/nameless entity", () => {
    expect(entityInitials(null)).toBe("");
    expect(entityInitials({})).toBe("");
  });
});

describe("virtualEntityFromFloatAccount", () => {
  it("builds a virtual fl-nepal entity from an account row", () => {
    const entity = virtualEntityFromFloatAccount({ name: "Nepal Ops Float", currency: "NPR" });
    expect(entity).toEqual({
      id: null,
      code: "fl-nepal",
      legal_name: "Nepal Ops Float",
      trading_name: null,
      country_code: "NP",
      currency: "NPR",
      status: "active",
      virtual: true,
    });
  });

  it("is null-safe and applies sensible defaults", () => {
    const entity = virtualEntityFromFloatAccount(null);
    expect(entity.legal_name).toBe("Nepal");
    expect(entity.currency).toBe("NPR");
    expect(entity.virtual).toBe(true);
    expect(entity.id).toBeNull();
  });

  it("is safe for undefined input", () => {
    expect(() => virtualEntityFromFloatAccount(undefined)).not.toThrow();
  });
});

describe("activeEntities", () => {
  const rows = [
    { id: "1", legal_name: "Zeta Co", status: "active" },
    { id: "2", legal_name: "Alpha Co", status: "active" },
    { id: "3", legal_name: "Archived Co", status: "archived" },
    { id: "4", trading_name: "beta trading", legal_name: "Beta Co", status: "active" },
  ];

  it("filters out archived entities", () => {
    const result = activeEntities(rows);
    expect(result.find((e) => e.id === "3")).toBeUndefined();
    expect(result.length).toBe(3);
  });

  it("sorts by display name, case-insensitively", () => {
    const result = activeEntities(rows).map((e) => e.id);
    expect(result).toEqual(["2", "4", "1"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...rows];
    activeEntities(rows);
    expect(rows).toEqual(copy);
  });

  it("returns an empty array for null/undefined input", () => {
    expect(activeEntities(null)).toEqual([]);
    expect(activeEntities(undefined)).toEqual([]);
  });

  it("skips nullish entries without throwing", () => {
    expect(() => activeEntities([null, { id: "1", legal_name: "A", status: "active" }, undefined])).not.toThrow();
    expect(activeEntities([null, { id: "1", legal_name: "A", status: "active" }, undefined]).length).toBe(1);
  });
});

describe("maskAccountNumber", () => {
  it("masks all but the last 4 characters", () => {
    expect(maskAccountNumber("12341234")).toBe("••••1234");
  });

  it("masks a long number down to its last 4 digits", () => {
    expect(maskAccountNumber("123456789")).toBe("•••••6789");
  });

  it("returns a fixed mask for null/undefined/empty values", () => {
    expect(maskAccountNumber(null)).toBe("••••");
    expect(maskAccountNumber(undefined)).toBe("••••");
    expect(maskAccountNumber("")).toBe("••••");
  });

  it("returns a fixed mask for short values that would otherwise leak length", () => {
    expect(maskAccountNumber("12")).toBe("••••");
  });

  it("never throws on non-string input", () => {
    expect(() => maskAccountNumber(123456789)).not.toThrow();
    expect(maskAccountNumber(123456789)).toBe("•••••6789");
  });
});
