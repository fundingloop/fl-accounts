"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

function LoginInner() {
  const params = useSearchParams();
  const denied = params.get("denied") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message || "Sign in failed.");
      setLoading(false);
      return;
    }
    // Full reload so the middleware re-evaluates the (now signed-in) session.
    window.location.href = "/";
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#012E41", padding: "20px" }}>
      <div style={{ width: "100%", maxWidth: "380px", background: "#fff", borderRadius: "14px", padding: "34px 32px", boxShadow: "0 20px 50px rgba(0,0,0,.25)" }}>
        <div style={{ fontSize: "22px", fontWeight: 700, color: "#012E41", marginBottom: "2px" }}>FL Accounts</div>
        <div style={{ fontSize: "13px", color: "#6b7c85", marginBottom: "24px" }}>Nepal accounts and cashflow</div>

        {denied && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", fontSize: "12px", borderRadius: "8px", padding: "10px 12px", marginBottom: "16px" }}>
            Your account doesn&apos;t have access to FL Accounts. Contact an admin.
          </div>
        )}

        <form onSubmit={submit}>
          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334", marginBottom: "5px" }}>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #d7dee1", borderRadius: "8px", fontSize: "14px", marginBottom: "14px", outline: "none" }} />

          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334", marginBottom: "5px" }}>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #d7dee1", borderRadius: "8px", fontSize: "14px", marginBottom: "18px", outline: "none" }} />

          {error && <div style={{ color: "#B91C1C", fontSize: "12px", marginBottom: "14px" }}>{error}</div>}

          <button type="submit" disabled={loading}
            style={{ width: "100%", padding: "11px", border: "none", borderRadius: "8px", background: loading ? "#9fbcc4" : "#2BA99F", color: "#fff", fontSize: "14px", fontWeight: 600, cursor: loading ? "default" : "pointer" }}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
