import { codeMatches, OWNER_SESSION_MS, voiceConfigured } from "@/lib/voice";
import { caller, clearMisses, countMiss, device, deviceCookie, lockedUntil, ownerCookie, type Device } from "@/lib/voice-caller";
import { voiceStore } from "@/lib/voice-store";
import { signOwnerToken } from "@/lib/voice-token";

/**
 * Owner sign-in for the saved-calls view.
 * - POST `{ code }`: checks lockout, then VOICE_OWNER_CODE. A wrong code
 *   counts toward the same 5-attempt lockout as Talk's access code. The right
 *   one sets a signed httpOnly cookie for 4 hours.
 * - DELETE: signs out (clears the cookie).
 */

const MAX_CODE_CHARS = 200;
const SNAG = "Couldn't sign in. Try again in a moment.";

/** JSON reply that keeps the device cookie (for the lockout), plus any extra cookie, and is never cached. */
function reply(body: unknown, status: number, dev: Device, extraCookie?: string) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", deviceCookie(dev));
  if (extraCookie) headers.append("Set-Cookie", extraCookie);
  return Response.json(body, { status, headers });
}

const locked = (until: Date, dev: Device) =>
  reply({ error: "Too many wrong codes. Try again later.", reason: "locked", availableAt: until.toISOString() }, 429, dev);

export async function POST(request: Request) {
  if (!voiceConfigured()) return Response.json({ error: "Talk isn't set up yet." }, { status: 503 });
  const dev = device(request);
  const c = caller(request, dev);
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.slice(0, MAX_CODE_CHARS) : "";
  const now = new Date();
  try {
    const store = voiceStore();
    const until = await lockedUntil(store, c, now);
    if (until) return locked(until, dev);

    if (!codeMatches(code, process.env.VOICE_OWNER_CODE)) {
      const nowLocked = await countMiss(store, c, now);
      if (nowLocked) return locked(nowLocked, dev);
      return reply({ error: "That code isn't right.", reason: "wrong_code" }, 403, dev);
    }
    await clearMisses(store, c);

    const expiresAt = new Date(now.getTime() + OWNER_SESSION_MS);
    return reply({ signedIn: true, expiresAt: expiresAt.toISOString() }, 200, dev, ownerCookie(signOwnerToken(expiresAt), OWNER_SESSION_MS / 1000));
  } catch (err) {
    console.error("[voice/owner/session]", err);
    return reply({ error: SNAG }, 502, dev);
  }
}

export async function DELETE() {
  return Response.json({ signedIn: false }, { headers: { "Cache-Control": "no-store", "Set-Cookie": ownerCookie("", 0) } });
}
