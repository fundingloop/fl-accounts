// The only roles allowed into fl-accounts. An 'accounts' user is the Nepal
// finance role; manager + admin cross over from the CRM. bd_rep / read_only
// (and any unknown role) are denied.
export const ACCOUNTS_ALLOWED_ROLES = ["accounts", "manager", "admin"];

export function roleAllowed(roleType) {
  return ACCOUNTS_ALLOWED_ROLES.includes(roleType);
}

// Resolve the caller's active team_member row via a cookie/anon client. Returns
// { user, member } - member is null if not a team member. RLS lets a team
// member read their own row.
export async function resolveMember(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, member: null };
  const { data: member } = await supabase
    .from("team_members")
    .select("id, full_name, email, role_type, active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  return { user, member: member || null };
}
