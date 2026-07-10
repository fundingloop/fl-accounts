import { NextResponse } from "next/server";
import { createCookieClient } from "@/lib/supabase-ssr";
import { createServiceClient } from "@/lib/supabase-server";
import { resolveMember, roleAllowed } from "@/lib/roles";
import { friendlyPostingError } from "@/lib/ledgerPostingErrors";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Reversal is server-side only, same reasoning as app/api/ledger/post -
// fin_reverse_journal (see the fin_ledger migration) is executable ONLY by
// service_role. It creates a new draft reversal journal (swapped debits and
// credits) and posts it in the same transaction.
//
// Order of operations: gate on role, then re-load the original journal
// under the CALLER'S RLS client as a defense-in-depth read - 404 if not
// visible, 409 if it isn't posted yet (only posted journals can be
// reversed). Only then call the RPC with the service client, which
// independently re-verifies the actor and re-checks "not already reversed"
// against the DB (the partial unique index is the ultimate race backstop).
// The RPC call is the durable point: on success return the new reversal
// journal's id so the UI can navigate straight to it.
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

  const journalId = body?.journal_id;
  if (!journalId || typeof journalId !== "string") {
    return NextResponse.json({ error: "Missing journal_id" }, { status: 400 });
  }

  const journalDate = body?.journal_date;
  if (journalDate !== undefined && journalDate !== null && journalDate !== "" && !DATE_RE.test(journalDate)) {
    return NextResponse.json({ error: "journal_date must be in YYYY-MM-DD format" }, { status: 400 });
  }

  const description = body?.description;
  if (description !== undefined && description !== null && typeof description !== "string") {
    return NextResponse.json({ error: "description must be a string" }, { status: 400 });
  }

  const { data: journal, error: loadErr } = await cookieClient
    .from("fin_journals")
    .select("id, status, entity_id")
    .eq("id", journalId)
    .maybeSingle();

  if (loadErr) {
    console.error("ledger/reverse: could not load journal", loadErr);
    return NextResponse.json({ error: "Could not load the journal" }, { status: 500 });
  }
  if (!journal) {
    return NextResponse.json({ error: "Journal not found" }, { status: 404 });
  }
  if (journal.status !== "posted") {
    return NextResponse.json({ error: "Only posted journals can be reversed" }, { status: 409 });
  }

  const service = createServiceClient();
  const { data: reversalJournalId, error: reverseErr } = await service.rpc("fin_reverse_journal", {
    p_journal_id: journalId,
    p_actor_id: user.id,
    p_journal_date: journalDate || null,
    p_description: description || null,
  });

  if (reverseErr) {
    const { message, known } = friendlyPostingError(reverseErr);
    if (!known) console.error("ledger/reverse: fin_reverse_journal failed", reverseErr);
    return NextResponse.json({ error: message }, { status: known ? 422 : 500 });
  }

  return NextResponse.json({ reversed: true, reversal_journal_id: reversalJournalId });
}
