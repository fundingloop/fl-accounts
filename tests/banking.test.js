import { describe, it, expect } from "vitest";
import { bankAccountTypeLabel, transfersForEntity, nextTransferActions } from "../lib/banking.js";

describe("bankAccountTypeLabel", () => {
  it("maps every known account_type to a friendly label", () => {
    expect(bankAccountTypeLabel("operating")).toBe("Operating");
    expect(bankAccountTypeLabel("payroll")).toBe("Payroll");
    expect(bankAccountTypeLabel("savings")).toBe("Savings");
    expect(bankAccountTypeLabel("loan")).toBe("Loan");
    expect(bankAccountTypeLabel("credit_card")).toBe("Credit card");
    expect(bankAccountTypeLabel("other")).toBe("Other");
  });

  it("falls back to Other for unknown/null/undefined values", () => {
    expect(bankAccountTypeLabel("bogus")).toBe("Other");
    expect(bankAccountTypeLabel(null)).toBe("Other");
    expect(bankAccountTypeLabel(undefined)).toBe("Other");
  });
});

describe("transfersForEntity", () => {
  const rows = [
    { id: "1", from_entity_id: "au", to_entity_id: "np" },
    { id: "2", from_entity_id: "np", to_entity_id: "au" },
    { id: "3", from_entity_id: "np", to_entity_id: "np" },
    { id: "4", from_entity_id: "us", to_entity_id: "uk" },
  ];

  it("returns transfers where the entity is the sender or the receiver", () => {
    const result = transfersForEntity(rows, "au").map((r) => r.id);
    expect(result).toEqual(["1", "2"]);
  });

  it("returns every row for 'all'", () => {
    expect(transfersForEntity(rows, "all").length).toBe(4);
  });

  it("returns every row for a null/undefined entityId", () => {
    expect(transfersForEntity(rows, null).length).toBe(4);
    expect(transfersForEntity(rows, undefined).length).toBe(4);
  });

  it("returns an empty array when nothing matches", () => {
    expect(transfersForEntity(rows, "no-such-entity")).toEqual([]);
  });

  it("is null-safe and does not mutate the input array", () => {
    expect(transfersForEntity(null, "au")).toEqual([]);
    expect(transfersForEntity(undefined, "au")).toEqual([]);
    const copy = [...rows];
    transfersForEntity(rows, "au");
    expect(rows).toEqual(copy);
  });
});

describe("nextTransferActions", () => {
  it("planned allows mark_in_transit, settle, cancel and delete", () => {
    expect(nextTransferActions("planned")).toEqual(["mark_in_transit", "settle", "cancel", "delete"]);
  });

  it("in_transit allows settle and cancel only", () => {
    expect(nextTransferActions("in_transit")).toEqual(["settle", "cancel"]);
  });

  it("settled is terminal - no actions", () => {
    expect(nextTransferActions("settled")).toEqual([]);
  });

  it("cancelled allows delete only", () => {
    expect(nextTransferActions("cancelled")).toEqual(["delete"]);
  });

  it("returns an empty array for an unknown/null/undefined status", () => {
    expect(nextTransferActions("bogus")).toEqual([]);
    expect(nextTransferActions(null)).toEqual([]);
    expect(nextTransferActions(undefined)).toEqual([]);
  });
});
