"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { useEntities } from "@/lib/useEntities";
import { entityDisplayName, entityInitials } from "@/lib/entities";

function Avatar({ entity }) {
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        background: "rgba(43,169,159,.25)",
        color: "#2BA99F",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontSize: 11.5,
        fontWeight: 700,
        letterSpacing: ".02em",
      }}
    >
      {entity ? entityInitials(entity) || "?" : "ALL"}
    </div>
  );
}

// Persistent entity selector rendered in the AppShell sidebar. Lists active
// entities plus "All entities"; degrades to a disabled single-entity display
// when the fin_entities migration has not been applied yet.
export default function EntitySwitcher() {
  const { entities, selection, setSelection, currentEntity, allSelected, loading, schemaMissing } = useEntities();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const label = allSelected ? "All entities" : entityDisplayName(currentEntity);
  const currency = allSelected ? "All currencies" : currentEntity?.currency || "";

  if (schemaMissing) {
    const virtual = entities[0] || null;
    return (
      <div
        style={{ padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,.1)" }}
        title="Entity registry pending migration"
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 10px",
            borderRadius: 8,
            background: "rgba(255,255,255,.05)",
            cursor: "not-allowed",
          }}
        >
          <Avatar entity={virtual} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {virtual ? entityDisplayName(virtual) : "Loading..."}
            </div>
            <div style={{ fontSize: 11, color: "#9fc4c0" }}>{virtual?.currency || ""}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} style={{ position: "relative", padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,.1)" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 10px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,.14)",
          background: open ? "rgba(255,255,255,.08)" : "transparent",
          cursor: loading ? "default" : "pointer",
          textAlign: "left",
          fontFamily: "inherit",
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Avatar entity={currentEntity} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {loading ? "Loading..." : label}
          </div>
          <div style={{ fontSize: 11, color: "#9fc4c0" }}>{loading ? "" : currency}</div>
        </div>
        <ChevronDown size={15} color="#9fc4c0" style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 20,
            right: 20,
            marginTop: 6,
            background: "#fff",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,.25)",
            overflow: "hidden",
            zIndex: 20,
          }}
        >
          <button
            role="option"
            aria-selected={allSelected}
            onClick={() => {
              setSelection("all");
              setOpen(false);
            }}
            style={optionStyle(allSelected)}
          >
            <span>All entities</span>
            {allSelected && <Check size={14} color="#2BA99F" />}
          </button>
          {entities.map((entity) => {
            const key = entity.id || entity.code;
            const selected = !allSelected && (selection === entity.id || selection === entity.code);
            return (
              <button
                key={key}
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setSelection(key);
                  setOpen(false);
                }}
                style={optionStyle(selected)}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {entityDisplayName(entity)} <span style={{ color: "#8a99a0" }}>({entity.currency})</span>
                </span>
                {selected && <Check size={14} color="#2BA99F" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function optionStyle(selected) {
  return {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "10px 12px",
    border: "none",
    borderBottom: "1px solid #f0f2f3",
    background: selected ? "#EFFBF9" : "#fff",
    color: "#0f2733",
    fontSize: 13,
    fontWeight: selected ? 600 : 400,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
  };
}
