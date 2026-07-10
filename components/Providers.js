"use client";

import { EntityProvider } from "@/lib/useEntities";

// Thin client wrapper so the (server) root layout can stay a server
// component while still wrapping the app in client-side context providers.
export default function Providers({ children }) {
  return <EntityProvider>{children}</EntityProvider>;
}
