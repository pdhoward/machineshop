import { catalogConfigured } from "@/lib/catalog";
import { buildSessionConfig, codeMatches, voiceConfigured } from "@/lib/voice";
import { caller, clearMisses, countMiss, device, deviceCookie, lockedUntil, type Device } from "@/lib/voice-caller";
import { voiceStore } from "@/lib/voice-store";
import { bearerToken, signSessionToken, verifySessionToken } from "@/lib/voice-token";

/**
 * Talk mode's call session.
 * - GET: whether Talk is available now, or locked out until when.
 * - POST `{ code }`: checks configuration, lockout, then the access code (a
 *   wrong code counts toward lockout). Then gets a one-call pass from OpenAI,
 *   records the call and returns the pass, the end time and a signed session
 *   token. There is no wait between calls; each is capped at 5 minutes. The
 *   OpenAI key never leaves the server.
 * - DELETE with `Authorization: Bearer <token>`: marks the call ended.
 * The device ID lives in an httpOnly cookie set here.
 */

const MAX_CODE_CHARS = 200;

const OPENAI_CLIENT_SECRETS = "https://api.openai.com/v1/realtime/client_secrets";
/** How long the browser has to connect with the pass; the call itself is capped at 5 minutes. */
const PASS_SECONDS = 60;

const SNAG = "Talk hit a snag. Try again in a moment, or type your question.";

const ready = () => voiceConfigured() && catalogConfigured();
const notReady = () => Response.json({ error: "Talk isn't set up yet.", available: false }, { status: 503 });

/** JSON reply that (re)sets the device cookie and is never cached. */
function reply(body: unknown, status: number, dev: Device) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Set-Cookie": deviceCookie(dev) } });
}

const locked = (until: Date, dev: Device) =>
  reply({ error: "Too many wrong codes. Try again later.", reason: "locked", availableAt: until.toISOString() }, 429, dev);

/** A one-call pass (OpenAI realtime client secret) for the browser, or null if OpenAI refused. */
async function requestPass(now: Date): Promise<{ value: string; expiresAt: Date } | null> {
  const res = await fetch(OPENAI_CLIENT_SECRETS, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: PASS_SECONDS },
      session: buildSessionConfig(process.env.VOICE_MODEL!),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.error("[voice/session] OpenAI refused the pass:", res.status);
    return null;
  }
  const data = (await res.json().catch(() => null)) as { value?: unknown; expires_at?: unknown } | null;
  if (typeof data?.value !== "string" || !data.value) return null;
  const expiresAt = typeof data.expires_at === "number" ? new Date(data.expires_at * 1000) : new Date(now.getTime() + PASS_SECONDS * 1000);
  return { value: data.value, expiresAt };
}

export async function GET(request: Request) {
  if (!ready()) return notReady();
  const dev = device(request);
  const c = caller(request, dev);
  const now = new Date();
  try {
    const store = voiceStore();
    const until = await lockedUntil(store, c, now);
    if (until) return reply({ available: false, reason: "locked", availableAt: until.toISOString() }, 200, dev);
    return reply({ available: true }, 200, dev);
  } catch (err) {
    console.error("[voice/session]", err);
    return reply({ error: SNAG }, 502, dev);
  }
}

export async function POST(request: Request) {
  if (!ready()) return notReady();
  const dev = device(request);
  const c = caller(request, dev);
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.slice(0, MAX_CODE_CHARS) : "";
  const now = new Date();
  try {
    const store = voiceStore();
    const until = await lockedUntil(store, c, now);
    if (until) return locked(until, dev);

    if (!codeMatches(code, process.env.VOICE_ACCESS_CODE)) {
      const nowLocked = await countMiss(store, c, now);
      if (nowLocked) return locked(nowLocked, dev);
      return reply({ error: "That code isn't right.", reason: "wrong_code" }, 403, dev);
    }
    await clearMisses(store, c);

    // Get the pass before recording the call, so an OpenAI failure doesn't record a call that never happened.
    const pass = await requestPass(now);
    if (!pass) return reply({ error: SNAG }, 502, dev);
    const session = await store.startSession(c, now);
    return reply(
      {
        pass: pass.value,
        passExpiresAt: pass.expiresAt.toISOString(),
        endsAt: session.endsAt.toISOString(),
        token: signSessionToken({ sessionId: session.id, endsAt: session.endsAt }),
      },
      200,
      dev,
    );
  } catch (err) {
    console.error("[voice/session]", err);
    return reply({ error: SNAG }, 502, dev);
  }
}

export async function DELETE(request: Request) {
  if (!ready()) return notReady();
  const claim = verifySessionToken(bearerToken(request));
  if (!claim) return Response.json({ error: "No call to end." }, { status: 401 });
  try {
    const ended = await voiceStore().endSession(claim.sessionId, new Date());
    return Response.json({ ended }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[voice/session]", err);
    return Response.json({ error: SNAG }, { status: 502 });
  }
}
