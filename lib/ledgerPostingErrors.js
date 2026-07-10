// Maps a raw Postgres error from the fin_post_journal / fin_reverse_journal
// RPCs (see the fin_ledger migration) into a message safe to show a user.
// The posting engine's RAISE EXCEPTION messages are already written in plain
// English for exactly this purpose, so a *recognised* validation failure is
// passed through verbatim - it's honest and specific ("journal does not
// balance: debits 100.00 vs credits 80.00"). Anything else (a genuine
// server/DB fault the caller can't act on) becomes a generic message, and
// `known: false` tells the route to log the original server-side and
// respond 500 instead of 422.
const KNOWN_PATTERNS = [
  /not authorised/i,
  /only draft journals/i,
  /only posted journals/i,
  /does not balance/i,
  /at least one debit and one credit/i,
  /is not postable/i,
  /is not active/i,
  /different entity/i,
  /currency/i,
  /already been reversed/i,
  /already reversed/i,
  /not found/i,
];

const GENERIC_MESSAGE = "Could not complete this action. Please try again or contact support.";

// friendlyPostingError(err) -> { message, known } - message is safe to show
// the user; known is false when the route should log the raw error and
// return 500 instead of 422.
export function friendlyPostingError(err) {
  const message = err?.message || "";
  const known = !!message && KNOWN_PATTERNS.some((re) => re.test(message));
  return {
    message: known ? message : GENERIC_MESSAGE,
    known,
  };
}
