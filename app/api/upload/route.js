import { NextResponse } from "next/server";
import { createCookieClient } from "@/lib/supabase-ssr";
import { createServiceClient } from "@/lib/supabase-server";
import { resolveMember, roleAllowed } from "@/lib/roles";

// File upload is server-route-only, by design (see build brief): the browser
// never talks to storage directly. This route (1) confirms the caller is a
// signed-in accounts-app user via the cookie-bound client, then (2) uses the
// service-role client to verify the bill is real and belongs to the posted
// account before writing anything, and to perform the actual upload + DB
// update. Never accept the client's account_id at face value.
export const runtime = "nodejs";

const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 15 * 1024 * 1024; // 15MB

function sanitiseFilename(name) {
  const base = String(name || "file").split(/[\\/]/).pop();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.slice(-120) || "file";
}

export async function POST(request) {
  const cookieClient = createCookieClient();
  const { user, member } = await resolveMember(cookieClient);
  if (!user || !member || !roleAllowed(member.role_type)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file");
  const billId = formData.get("bill_id");
  const accountId = formData.get("account_id");

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!billId || !accountId) {
    return NextResponse.json({ error: "Missing bill_id or account_id" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Only image or PDF files are allowed" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is too large (15MB max)" }, { status: 400 });
  }

  const service = createServiceClient();

  // Confirm the bill exists AND its account_id matches the posted account_id.
  const { data: bill, error: billErr } = await service
    .from("bills")
    .select("id, account_id")
    .eq("id", billId)
    .maybeSingle();

  if (billErr || !bill || bill.account_id !== accountId) {
    return NextResponse.json({ error: "Bill not found for this account" }, { status: 404 });
  }

  const filename = sanitiseFilename(file.name);
  const path = `${accountId}/${billId}/${filename}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await service.storage
    .from("account-invoices")
    .upload(path, buffer, { contentType: file.type, upsert: true });

  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { error: updateErr } = await service.from("bills").update({ attachment_path: path }).eq("id", billId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ path });
}
