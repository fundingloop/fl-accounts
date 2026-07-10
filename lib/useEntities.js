"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { isMissingSchemaError } from "@/lib/payrollSnapshots";
import { activeEntities, virtualEntityFromFloatAccount } from "@/lib/entities";

// localStorage key for the persisted entity selection. Guarded everywhere
// behind a `typeof window !== "undefined"` check so this module is safe to
// import from a server component tree (Next.js App Router SSR pass).
const STORAGE_KEY = "fl-accounts.entity-selection";

function readStoredSelection() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage may be unavailable (privacy mode, disabled cookies, etc).
    return null;
  }
}

function writeStoredSelection(value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Best-effort only - selection just won't survive a reload.
  }
}

// Resolve a stored/candidate selection against the currently loaded active
// entities: 'all' is always valid; an entity id or code is valid only if it
// matches a loaded entity. An invalid/missing value falls back to the first
// active entity (by display-name sort), or 'all' if there are none.
function resolveSelection(candidate, entities) {
  if (candidate === "all") return "all";
  if (candidate && entities.some((e) => e.id === candidate || e.code === candidate)) {
    return candidate;
  }
  return entities.length > 0 ? entities[0].id || entities[0].code : "all";
}

const EntitiesContext = createContext(null);

// EntityProvider - loads the fin_entities registry once on mount. Degrades
// gracefully to a single virtual entity (see lib/entities.js) when the
// migration that creates fin_entities has not been applied yet, so the rest
// of the app stays fully usable pre-migration.
export function EntityProvider({ children }) {
  const [entities, setEntities] = useState([]);
  const [selection, setSelectionState] = useState("all");
  const [loading, setLoading] = useState(true);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("fin_entities")
      .select("*")
      .order("legal_name", { ascending: true });

    if (err && isMissingSchemaError(err)) {
      // Pre-migration fallback: build a single virtual entity from the one
      // float_accounts row the app already knows about (same query as
      // lib/useFloatAccount.js - oldest row wins).
      setSchemaMissing(true);
      const { data: floatRows } = await supabase
        .from("float_accounts")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(1);
      const virtual = virtualEntityFromFloatAccount(floatRows && floatRows[0]);
      const list = [virtual];
      setEntities(list);
      const storedFallback = readStoredSelection();
      const resolvedFallback = resolveSelection(storedFallback, list);
      setSelectionState(resolvedFallback);
      writeStoredSelection(resolvedFallback);
      setLoading(false);
      return;
    }

    if (err) {
      setError(err.message || "Could not load entities.");
      setEntities([]);
      setLoading(false);
      return;
    }

    setSchemaMissing(false);
    const list = activeEntities(data || []);
    setEntities(list);
    const stored = readStoredSelection();
    const resolved = resolveSelection(stored, list);
    setSelectionState(resolved);
    writeStoredSelection(resolved);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSelection = useCallback((value) => {
    setSelectionState(value);
    writeStoredSelection(value);
  }, []);

  const currentEntity = useMemo(() => {
    if (selection === "all") return null;
    return entities.find((e) => e.id === selection || e.code === selection) || null;
  }, [entities, selection]);

  const allSelected = selection === "all";

  const value = useMemo(
    () => ({
      entities,
      selection,
      setSelection,
      currentEntity,
      allSelected,
      loading,
      schemaMissing,
      error,
      refresh,
    }),
    [entities, selection, setSelection, currentEntity, allSelected, loading, schemaMissing, error, refresh]
  );

  return <EntitiesContext.Provider value={value}>{children}</EntitiesContext.Provider>;
}

// useEntities() - read the entity context. Throws if used outside
// EntityProvider so misuse fails loudly during development.
export function useEntities() {
  const ctx = useContext(EntitiesContext);
  if (!ctx) {
    throw new Error("useEntities() must be used within an <EntityProvider>.");
  }
  return ctx;
}

// useCurrentEntity() - convenience subset for components that only care
// about "what entity am I looking at right now", not the full switcher API.
export function useCurrentEntity() {
  const { currentEntity, allSelected, loading, schemaMissing } = useEntities();
  return { entity: currentEntity, allSelected, loading, schemaMissing };
}
