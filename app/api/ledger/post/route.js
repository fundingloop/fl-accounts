import { NextResponse } from "next/server";
import { createCookieClient } from "@/lib/supabase-ssr";
import { createServiceClient } from "@/lib/supabase-server";
import { resolveMember, roleAllowed } from "@/lib/roles";
import { friendlyPostingError } from "@/lib/ledgerPostingErrors";

// Posting is server-side only: fin_post_journal (see the fin_ledger
// migration) is executable ONLY by service_role, so this route is the sole
// path from the UI to a posted journal - a client can never flip
// fin_journals.status itself (RLS blocks it, and the guard trigger blocks it
// again even for service_role writes outside the RPC).
//
// Order of operations: gate on role first (cheap, no DB write). Then
// re-load the journal under the CALLER'S RLS client as a defense-in-depth
// read - 404 if the caller can't even see it, 409 if it's already posted -
// before ever touching the service client. Only then call the RPC with the
// service client; the RPC independently re-verifies the actor against
// team_members, so this route's role gate is a fast early-exit, not the
// sole guard. The RPC call is the durable point: on success the journal is
// posted and its journal_no assigned; report that back honestly.
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

  const { data: journal, error: loadErr } = await cookieClient
    .from("fin_journals")
    .select("id, status, entity_id")
    .eq("id", journalId)
    .maybeSingle();

  if (loadErr) {
    console.error("ledger/post: could not load journal", loadErr);
    return NextResponse.json({ error: "Could not load the journal" }, { status: 500 });
  }
  if (!journal) {
    return NextResponse.json({ error: "Journal not found" }, { status: 404 });
  }
  if (journal.status !== "draft") {
    return NextResponse.json({ error: "Only draft journals can be posted" }, { status: 409 });
  }

  const service = createServiceClient();
  const { data: journalNo, error: postErr } = await service.rpc("fin_post_journal", {
    p_journal_id: journalId,
    p_actor_id: user.id,
  });

  if (postErr) {
    const { message, known } = friendlyPostingError(postErr);
    if (!known) console.error("ledger/post: fin_post_journal failed", postErr);
    return NextResponse.json({ error: message }, { status: known ? 422 : 500 });
  }

  return NextResponse.json({ posted: true, journal_no: journalNo });
}
