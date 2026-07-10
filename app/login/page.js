"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

function LoginInner() {
  const params = useSearchParams();
  const denied = params.get("denied") === "1";
  const [step, setStep] = useState("password"); // "password" | "mfa"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [mfaError, setMfaError] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      if (data && data.nextLevel === "aal2" && data.currentLevel !== "aal2") {
        setStep("mfa");
      }
    });
  }, []);

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
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data && data.nextLevel === "aal2" && data.currentLevel !== "aal2") {
      setStep("mfa");
      setLoading(false);
      return;
    }
    // Full reload so the middleware re-evaluates the (now signed-in) session.
    window.location.href = "/";
  };

  const submitMfa = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMfaError("");
    const supabase = createClient();
    const { data: factorData, error: fErr } = await supabase.auth.mfa.listFactors();
    if (fErr || !factorData?.totp?.length) {
      setMfaError("No authenticator is enrolled on this account.");
      setLoading(false);
      return;
    }
    const factorId = factorData.totp[0].id;
    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
    if (cErr) {
      setMfaError("That code did not work - try again.");
      setLoading(false);
      return;
    }
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
    if (vErr) {
      setMfaError("That code did not work - try again.");
      setLoading(false);
      return;
    }
    window.location.href = "/";
  };

  const useDifferentAccount = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setStep("password");
    setEmail("");
    setPassword("");
    setCode("");
    setMfaError("");
    setError("");
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

        {step === "password" ? (
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
        ) : (
          <form onSubmit={submitMfa}>
            <p style={{ fontSize: "13px", color: "#6b7c85", marginBottom: "16px" }}>
              Enter the 6-digit code from your authenticator app.
            </p>

            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              required
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #d7dee1", borderRadius: "8px", fontSize: "18px", letterSpacing: "4px", textAlign: "center", marginBottom: "18px", outline: "none" }}
            />

            {mfaError && <div style={{ color: "#B91C1C", fontSize: "12px", marginBottom: "14px" }}>{mfaError}</div>}

            <button type="submit" disabled={loading}
              style={{ width: "100%", padding: "11px", border: "none", borderRadius: "8px", background: loading ? "#9fbcc4" : "#2BA99F", color: "#fff", fontSize: "14px", fontWeight: 600, cursor: loading ? "default" : "pointer" }}>
              {loading ? "Verifying..." : "Verify"}
            </button>

            <button type="button" onClick={useDifferentAccount}
              style={{ width: "100%", marginTop: "14px", background: "none", border: "none", color: "#6b7c85", fontSize: "12.5px", cursor: "pointer", textDecoration: "underline" }}>
              Sign in with a different account
            </button>
          </form>
        )}
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
