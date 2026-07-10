"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useEntities } from "@/lib/useEntities";

// Every page resolves a float account on load and works from its
// id/currency/starting_float. Shared here so the three pages (/, /bills,
// /float) don't repeat the lookup.
//
// Entity-aware: when a specific entity (with a real fin_entities id) is
// selected in the EntitySwitcher and the entities schema is live, the float
// account is resolved from that entity's rows only. When "All entities" is
// selected, or the entities schema is not applied yet (schemaMissing / a
// virtual entity with id === null), this falls back to the pre-multi-entity
// behaviour: the oldest row in the whole table wins.
//
// Note: we deliberately select "*" and filter by entity_id in JS rather than
// in the query. A pre-migration database's float_accounts table does not
// have an entity_id column yet, so `.eq("entity_id", ...)` would error via
// PostgREST; a plain `select *` is safe against both schema versions.
export function useFloatAccount() {
  const { currentEntity, allSelected, schemaMissing } = useEntities();
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("float_accounts")
      .select("*")
      .order("created_at", { ascending: true });
    if (err) {
      setError(err.message || "Could not load the float account.");
      setAccount(null);
      setLoading(false);
      return;
    }

    const rows = data || [];
    const filterByEntity = !allSelected && !schemaMissing && currentEntity?.id;
    const scoped = filterByEntity ? rows.filter((row) => row.entity_id === currentEntity.id) : rows;
    setAccount(scoped[0] || null);
    setLoading(false);
  }, [allSelected, schemaMissing, currentEntity]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { account, loading, error, refresh, entity: currentEntity };
}
