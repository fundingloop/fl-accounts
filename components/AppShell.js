"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Receipt, Wallet, Users, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/bills", label: "Bills", Icon: Receipt },
  { href: "/float", label: "Float", Icon: Wallet },
  { href: "/payroll", label: "Payroll", Icon: Users },
];

// Shared chrome for all three pages: navy/teal left nav + sign out. Each page
// wraps its content in this, e.g. `return <AppShell>{...}</AppShell>`.
export default function AppShell({ children }) {
  const pathname = usePathname();

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex" }}>
      <aside
        style={{
          width: 224,
          flexShrink: 0,
          background: "#012E41",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          position: "sticky",
          top: 0,
          height: "100vh",
        }}
      >
        <div style={{ padding: "22px 20px 18px", borderBottom: "1px solid rgba(255,255,255,.1)" }}>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: ".2px" }}>FL Accounts</div>
          <div style={{ fontSize: 11, color: "#9fc4c0", marginTop: 2 }}>Nepal cashflow</div>
        </div>

        <nav style={{ flex: 1, padding: "14px 10px" }}>
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 8,
                  marginBottom: 4,
                  textDecoration: "none",
                  fontSize: 13.5,
                  fontWeight: active ? 600 : 400,
                  background: active ? "#2BA99F" : "transparent",
                  color: active ? "#fff" : "#c9dade",
                  transition: "background .15s ease",
                }}
              >
                <Icon size={17} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div style={{ padding: 14, borderTop: "1px solid rgba(255,255,255,.1)" }}>
          <button
            onClick={signOut}
            style={{
              width: "100%",
              padding: "9px",
              border: "1px solid rgba(255,255,255,.22)",
              borderRadius: 8,
              background: "transparent",
              color: "#e7f0ef",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              fontFamily: "inherit",
            }}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, padding: "28px 32px", background: "#f6f8f9" }}>{children}</main>
    </div>
  );
}
