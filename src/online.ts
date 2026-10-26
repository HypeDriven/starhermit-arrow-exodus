// StarHermit online features for a signed-in player (a guest makes no
// platform calls): the invite link, and posting a finished round's total to
// the high-score board through the game's score script (score-script.js: a
// practice session whose socket carries {type:'result', scores}, which the
// script range-checks and writes to the board), as the JS SDK's
// submitScores did. Signing in is the runtime's (requestSignIn opens its
// Account dialog; in the StarHermit client the player is always signed in).
import { clipboard } from "starhermit:engine";
import { connectGame, inviteLink, leaderboards, onPlayerChange, player, sessions } from "starhermit:platform";

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
  const me = player();
  if (!me) return { posted: false, rank: null };
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": total } }); });
      socket.on("game", (data) => {
        const d = data as { type?: string; accepted?: string[] } | null;
        if (d && d.type === "result-ack") finish(Array.isArray(d.accepted) ? d.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const list = await leaderboards.list();
    const board = list.find((b) => b.key === "high-score");
    if (!board) return { posted: true, rank: null };
    const page = await leaderboards.entries(board.id, { pageSize: 100 });
    const mine = page.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}
