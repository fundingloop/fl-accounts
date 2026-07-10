"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase-browser";
import { formatDate } from "@/lib/format";

export default function SecurityPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [verifiedFactor, setVerifiedFactor] = useState(null);
  const [unverifiedFactor, setUnverifiedFactor] = useState(null);
  const [busy, setBusy] = useState(false);

  // Enrollment-in-progress state
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [factorId, setFactorId] = useState(null);
  const [code, setCode] = useState("");
  const [successNote, setSuccessNote] = useState("");

  const loadFactors = async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { data, error: err } = await supabase.auth.mfa.listFactors();
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    // listFactors().totp only contains VERIFIED factors - abandoned
    // (unverified) enrollments only show up in .all, so look there.
    const factors = data?.all || [];
    const verified = factors.find((f) => f.factor_type === "totp" && f.status === "verified") || null;
    const unverified = factors.find((f) => f.factor_type === "totp" && f.status !== "verified") || null;
    setVerifiedFactor(verified);
    setUnverifiedFactor(unverified);
    setLoading(false);
  };

  useEffect(() => {
    loadFactors();
  }, []);

  const startEnroll = async () => {
    setBusy(true);
    setError("");
    setSuccessNote("");
    const supabase = createClient();

    // An abandoned enrollment from a previous attempt - clear it first.
    if (unverifiedFactor) {
      await supabase.auth.mfa.unenroll({ factorId: unverifiedFactor.id });
    }

    const { data, error: err } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Authenticator app",
    });
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setCode("");
    setEnrolling(true);
    setBusy(false);
  };

  const cancelEnroll = async () => {
    setBusy(true);
    setError("");
    const supabase = createClient();
    if (factorId) {
      await supabase.auth.mfa.unenroll({ factorId });
    }
    setEnrolling(false);
    setQrCode("");
    setSecret("");
    setFactorId(null);
    setCode("");
    setBusy(false);
    loadFactors();
  };

  const verifyEnroll = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
    if (cErr) {
      setError(cErr.message);
      setBusy(false);
      return;
    }
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
    if (vErr) {
      setError(vErr.message || "That code did not work - try again.");
      setBusy(false);
      return;
    }
    setEnrolling(false);
    setQrCode("");
    setSecret("");
    setFactorId(null);
    setCode("");
    setSuccessNote("Authenticator verified - MFA is now required at sign-in.");
    setBusy(false);
    loadFactors();
  };

  const removeFactor = async () => {
    if (!window.confirm("Remove this authenticator? Signing in will no longer require a code.")) return;
    setBusy(true);
    setError("");
    setSuccessNote("");
    const supabase = createClient();
    const { error: err } = await supabase.auth.mfa.unenroll({ factorId: verifiedFactor.id });
    if (err) {
      // Supabase requires a recent MFA-verified session to unenroll - its
      // error text is already user-actionable, so surface it as-is.
      setError(err.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    loadFactors();
  };

  return (
    <AppShell>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#012E41", margin: 0 }}>Security</h1>
        <p style={{ fontSize: 13, color: "#6b7c85", margin: "4px 0 0" }}>Multi-factor authentication for your account</p>
      </div>

      {error && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{error}</span>
          <button onClick={() => setError("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#B91C1C" }}><X size={14} /></button>
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.06)", padding: 20, maxWidth: 520 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#012E41", marginBottom: 14 }}>Authenticator app (TOTP)</div>

        {loading ? (
          <div style={{ color: "#6b7c85", fontSize: 13.5 }}>Loading...</div>
        ) : enrolling ? (
          <form onSubmit={verifyEnroll}>
            <p style={{ fontSize: 13, color: "#334", marginBottom: 14 }}>
              Scan this QR code with your authenticator app (1Password, Google Authenticator, Authy...), then enter the 6-digit code it shows.
            </p>

            {qrCode && (
              // Plain <img> on purpose: this is a data: URL and the next/image
              // optimizer is disabled app-wide (see next.config.mjs).
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrCode} alt="TOTP QR code" style={{ width: 180, height: 180, marginBottom: 14, border: "1px solid #e0e6e8", borderRadius: 8 }} />
            )}

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "#6b7c85", textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 5 }}>
                Or enter this key manually
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 13, background: "#f6f8f9", border: "1px solid #e0e6e8", borderRadius: 7, padding: "8px 10px", wordBreak: "break-all", userSelect: "all" }}>
                {secret}
              </div>
            </div>

            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334", marginBottom: 5 }}>6-digit code</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              required
              style={{ width: "160px", padding: "8px 10px", border: "1px solid #d7dee1", borderRadius: 7, fontSize: 16, letterSpacing: "3px", textAlign: "center", fontFamily: "inherit", outline: "none", marginBottom: 16 }}
            />

            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" disabled={busy} style={{ background: "#2BA99F", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", fontFamily: "inherit" }}>
                {busy ? "Verifying..." : "Verify"}
              </button>
              <button type="button" onClick={cancelEnroll} disabled={busy} style={{ background: "#f2f4f5", color: "#334", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", fontFamily: "inherit" }}>
                Cancel
              </button>
            </div>
          </form>
        ) : verifiedFactor ? (
          <div>
            {successNote && (
              <div style={{ background: "#ECFDF5", border: "1px solid #A7F3D0", color: "#047857", fontSize: 12.5, borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
                {successNote}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f6f8f9", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "#012E41" }}>MFA is active on this account</div>
                <div style={{ fontSize: 12, color: "#6b7c85", marginTop: 2 }}>
                  {verifiedFactor.friendly_name || "Authenticator app"} - added {formatDate(verifiedFactor.created_at)}
                </div>
              </div>
            </div>
            <button
              onClick={removeFactor}
              disabled={busy}
              style={{ background: "#FEF2F2", color: "#B91C1C", border: "1px solid #FECACA", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", fontFamily: "inherit" }}
            >
              {busy ? "Removing..." : "Remove authenticator"}
            </button>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 13, color: "#334", marginBottom: 16 }}>
              Add an authenticator app (1Password, Google Authenticator, Authy...) - once verified, sign-in will require a 6-digit code.
            </p>
            <button
              onClick={startEnroll}
              disabled={busy}
              style={{ background: "#2BA99F", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", fontFamily: "inherit" }}
            >
              {busy ? "Starting..." : "Set up authenticator"}
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
