"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

// Every page resolves the single Nepal float account on load (v1 has exactly
// one row in float_accounts) and works from its id/currency/starting_float.
// Shared here so the three pages (/, /bills, /float) don't repeat the lookup.
export function useFloatAccount() {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("float_accounts")
      .select("id, name, currency, starting_float, float_as_of_date, created_at, updated_at")
      .limit(1);
    if (err) {
      setError(err.message || "Could not load the float account.");
      setAccount(null);
    } else {
      setAccount((data && data[0]) || null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { account, loading, error, refresh };
}
