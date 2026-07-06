import { NextResponse } from "next/server";
import { createCookieClient } from "@/lib/supabase-ssr";
import { createServiceClient } from "@/lib/supabase-server";
import { resolveMember, roleAllowed } from "@/lib/roles";

// Signed download URL, server-route-only. Never a broad client-side storage
// policy: the caller must be an accounts-app user, and the requested path
// must exactly match a real bill's current attachment_path (not just "some
// path under this account") before we mint a signed URL.
export const runtime = "nodejs";

export async function GET(request) {
  const cookieClient = createCookieClient();
  const { user, member } = await resolveMember(cookieClient);
  if (!user || !member || !roleAllowed(member.role_type)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const path = searchParams.get("path");
  if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });

  // Path convention is {account_id}/{bill_id}/{filename}.
  const parts = path.split("/");
  if (parts.length < 3) return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  const [accountId, billId] = parts;

  const service = createServiceClient();
  const { data: bill, error: billErr } = await service
    .from("bills")
    .select("id, account_id, attachment_path")
    .eq("id", billId)
    .maybeSingle();

  if (billErr || !bill || bill.account_id !== accountId || bill.attachment_path !== path) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await service.storage.from("account-invoices").createSignedUrl(path, 60);

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Could not sign URL" }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl });
}
