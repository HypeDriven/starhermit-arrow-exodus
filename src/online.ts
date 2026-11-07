// StarHermit online features for a signed-in player (a guest makes no
// platform calls): the invite link, and posting a finished round's total to
// the high-score board through the game's score script (score-script.js, which
// range-checks it and writes it to the board) with leaderboards.submitScore.
// Signing in is the runtime's (requestSignIn opens its
// Account dialog; in the StarHermit client the player is always signed in).
import { clipboard } from "starhermit:engine";
import { inviteLink, leaderboards, onPlayerChange, player } from "starhermit:platform";

let link: string | null = null;
export function signedIn(): boolean { return player() !== null; }
export function displayName(): string { return (player()?.displayName ?? "").slice(0, 40); }

/** Fetches the invite link ahead, so a button press can copy it at once. */
export function refresh(): void {
  link = null;
  if (!player()) return;
  inviteLink().then((l) => { link = l; }, () => { link = null; });
}
onPlayerChange(() => refresh());

/** Copies the invite link (call while handling the button's press): the link
 * on success, or the text to show with the failure line. */
export function copyInvite(): { ok: boolean; link: string } {
  if (!link) return { ok: false, link: "" };
  try { clipboard.writeText(link); return { ok: true, link }; } catch { return { ok: false, link }; }
}

/** Posts a finished round's total; resolves whether it was taken and the
 * player's rank on the board (null when not among the first 100). Never rejects. */
export async function submitScore(total: number): Promise<{ posted: boolean; rank: number | null }> {
  const r = await leaderboards.submitScore("high-score", total);
  return { posted: r.accepted, rank: r.rank };
}
