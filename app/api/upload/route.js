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
//
// Multi-step operation contract: the order below is validate, upload the
// file, then update the bill row (the durable success point), then a
// best-effort cleanup of whichever file is now orphaned (the old attachment
// on success, or the just-uploaded file if the bill update fails). Cleanup
// failures are logged, never surfaced as the response - the DB row is what
// callers should trust.
export const runtime = "nodejs";

const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 15 * 1024 * 1024; // 15MB

function sanitiseFilename(name) {
  const base = String(name || "file").split(/[\\/]/).pop();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.slice(-120) || "file";
}

// Check the file's actual bytes against its declared MIME type so a renamed
// file can't slip past the ALLOWED_TYPES check above.
function matchesDeclaredType(buffer, type) {
  if (type === "application/pdf") {
    return buffer.slice(0, 4).toString("latin1") === "%PDF";
  }
  if (type === "image/png") {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return sig.every((byte, i) => buffer[i] === byte);
  }
  if (type === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (type === "image/webp") {
    return buffer.slice(0, 4).toString("latin1") === "RIFF" && buffer.slice(8, 12).toString("latin1") === "WEBP";
  }
  if (type === "image/gif") {
    const header = buffer.slice(0, 6).toString("latin1");
    return header === "GIF87a" || header === "GIF89a";
  }
  return false;
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

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!matchesDeclaredType(buffer, file.type)) {
    return NextResponse.json({ error: "File content does not match its declared type" }, { status: 400 });
  }

  const service = createServiceClient();

  // Confirm the bill exists AND its account_id matches the posted account_id.
  const { data: bill, error: billErr } = await service
    .from("bills")
    .select("id, account_id, attachment_path")
    .eq("id", billId)
    .maybeSingle();

  if (billErr || !bill || bill.account_id !== accountId) {
    return NextResponse.json({ error: "Bill not found for this account" }, { status: 404 });
  }

  const filename = sanitiseFilename(file.name);
  const path = `${accountId}/${billId}/${filename}`;

  const { error: uploadErr } = await service.storage
    .from("account-invoices")
    .upload(path, buffer, { contentType: file.type, upsert: true });

  if (uploadErr) {
    console.error("upload: storage upload failed", uploadErr);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  const { error: updateErr } = await service.from("bills").update({ attachment_path: path }).eq("id", billId);

  if (updateErr) {
    // The file made it to storage but the bill was never pointed at it -
    // best-effort remove the orphan so it isn't left behind forever.
    if (bill.attachment_path !== path) {
      try {
        const { error: removeErr } = await service.storage.from("account-invoices").remove([path]);
        if (removeErr) console.error("upload: failed to clean up orphaned file after update error", removeErr);
      } catch (cleanupErr) {
        console.error("upload: failed to clean up orphaned file after update error", cleanupErr);
      }
    }
    console.error("upload: bill update failed", updateErr);
    return NextResponse.json({ error: "The file was uploaded but could not be attached to the bill" }, { status: 500 });
  }

  // Success. If this replaced a previous attachment, best-effort remove the
  // old file - replaced attachments were previously orphaned forever.
  if (bill.attachment_path && bill.attachment_path !== path) {
    try {
      const { error: removeErr } = await service.storage.from("account-invoices").remove([bill.attachment_path]);
      if (removeErr) console.error("upload: failed to clean up replaced attachment", removeErr);
    } catch (cleanupErr) {
      console.error("upload: failed to clean up replaced attachment", cleanupErr);
    }
  }

  return NextResponse.json({ path });
}
