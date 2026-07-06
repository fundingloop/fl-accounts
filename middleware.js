import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { ACCOUNTS_ALLOWED_ROLES } from "@/lib/roles";

// Role-gated middleware. fl-accounts is reachable ONLY by an authenticated user
// whose team_member role is accounts / manager / admin. Everyone else (bd_rep,
// read_only, unknown, or not a team member) is bounced to /login. This is the
// front-door half of the security boundary; the DB-level RLS on the accounts
// tables is the other half.
export async function middleware(request) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/login";
  const isApi = pathname.startsWith("/api/");

  // Not signed in: allow /login, block everything else.
  if (!user) {
    if (isLogin) return response;
    if (isApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Signed in: check the role gate. A team member reads their own row under RLS.
  const { data: me } = await supabase
    .from("team_members")
    .select("role_type, active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  const allowed = !!me && ACCOUNTS_ALLOWED_ROLES.includes(me.role_type);

  if (!allowed) {
    if (isApi) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    // Wrong role: send to /login (it shows an access-denied message).
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("denied", "1");
    return isLogin ? response : NextResponse.redirect(url);
  }

  // Allowed user hitting /login: send them to the dashboard.
  if (isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
