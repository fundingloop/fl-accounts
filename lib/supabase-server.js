import { createClient } from "@supabase/supabase-js";

// Service-role client for server routes (invoice file upload/download). Bypasses
// RLS, so EVERY route that uses it must do its own role + ownership checks in
// code before returning data or signed URLs. Never import this into a browser
// component.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
