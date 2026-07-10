import { NextResponse } from "next/server";
import { createCookieClient } from "@/lib/supabase-ssr";
import { createServiceClient } from "@/lib/supabase-server";
import { resolveMember, roleAllowed } from "@/lib/roles";

// Server-side bill deletion so the bill's attachment files get cleaned up
// with it - a client-side row delete previously left the storage objects
// behind forever.
//
// Order of operations: delete the bill row under the CALLER'S RLS (defense
// in depth - the service role is never used for the row delete, so this can
// only ever delete a bill the caller's own policies allow), which is the
// durable success point. Then best-effort clean up whatever files were
// attached to it, using the service client for storage access. A cleanup
// failure is logged, not surfaced - the DB row is authoritative, and a
// leftover file in storage is an orphan to fix later, not a reason to tell
// the caller their delete failed.
export const runtime = "nodejs";

export async function POST(request) {
  const cookieClient = createCookieClient();
  const { user, member } = await resolveMember(cookieClient);
  if (!user || !member || !roleAllowed(member.role_type)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const billId = body?.bill_id;
  if (!billId || typeof billId !== "string") {
    return NextResponse.json({ error: "Missing bill_id" }, { status: 400 });
  }

  const { data: rows, error: deleteErr } = await cookieClient
    .from("bills")
    .delete()
    .eq("id", billId)
    .select("id, account_id, attachment_path");

  if (deleteErr) {
    console.error("bills/delete: row delete failed", deleteErr);
    return NextResponse.json({ error: "Could not delete the bill" }, { status: 500 });
  }

  const bill = rows?.[0];
  if (!bill) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  // Row is gone - best-effort clean up any attachment(s) under this bill's
  // storage prefix. Not just bill.attachment_path, in case of past uploads
  // that were never fully wired up to the bill row.
  try {
    const service = createServiceClient();
    const prefix = `${bill.account_id}/${bill.id}`;
    const { data: objects, error: listErr } = await service.storage.from("account-invoices").list(prefix);

    if (listErr) {
      console.error("bills/delete: could not list attachments for cleanup", listErr);
    } else if (objects && objects.length > 0) {
      const paths = objects.map((obj) => `${prefix}/${obj.name}`);
      const { error: removeErr } = await service.storage.from("account-invoices").remove(paths);
      if (removeErr) console.error("bills/delete: could not remove attachments", removeErr);
    }
  } catch (cleanupErr) {
    console.error("bills/delete: attachment cleanup failed", cleanupErr);
  }

  return NextResponse.json({ deleted: true });
}
