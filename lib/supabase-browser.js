import { createBrowserClient } from "@supabase/ssr";

// Browser client - anon key + the shared session cookie. Same pattern as
// fl-crm so a signed-in session is read identically.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
