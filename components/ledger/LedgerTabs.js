"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/ledger", label: "Journal entries" },
  { href: "/ledger/accounts", label: "Chart of accounts" },
];

// Shared sub-nav between the two Ledger pages. /ledger/new and /ledger/[id]
// are journal-entry sub-pages, so "Journal entries" stays highlighted there
// too - anything under /ledger that isn't /ledger/accounts.
export default function LedgerTabs() {
  const pathname = usePathname();
  const activeHref = pathname.startsWith("/ledger/accounts") ? "/ledger/accounts" : "/ledger";

  return (
    <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #e5e9ea", marginBottom: 20 }}>
      {TABS.map((tab) => {
        const active = tab.href === activeHref;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              padding: "10px 4px",
              marginRight: 24,
              fontSize: 13.5,
              fontWeight: active ? 600 : 500,
              color: active ? "#012E41" : "#6b7c85",
              textDecoration: "none",
              borderBottom: active ? "2px solid #2BA99F" : "2px solid transparent",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
