import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Cookie-bound server client for Server Components / Route Handlers - reads the
// signed-in session from the request cookies (anon key + user JWT, subject to
// RLS). Use this to identify the caller; use the service client only for the
// file-handling routes.
export function createCookieClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component where cookies are read-only - the
            // middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    }
  );
}
