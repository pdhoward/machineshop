import { callOpen, cleanLines, TRANSCRIPT_GRACE_MS, voiceConfigured } from "@/lib/voice";
import { voiceStore } from "@/lib/voice-store";
import { bearerToken, verifySessionToken } from "@/lib/voice-token";

/**
 * A call's transcript, always the caller's own: the session comes from the
 * signed token in `Authorization: Bearer <token>`, never from the request.
 * - POST `{ lines }`: saves cleaned lines while the call is open, plus a short
 *   grace period for the last lines after hang-up or 5:00.
 * - GET: returns this call's lines, during the call and after it.
 */

/** Room for 50 full-length lines; anything bigger isn't from our panel. */
const MAX_BODY_CHARS = 200_000;

const SNAG = "Couldn't reach the transcript. Try again in a moment.";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const notReady = () => reply({ error: "Talk isn't set up yet." }, 503);
const noCall = () => reply({ error: "No call found.", reason: "no_call" }, 401);

export async function POST(request: Request) {
  if (!voiceConfigured()) return notReady();
  const claim = verifySessionToken(bearerToken(request));
  if (!claim) return noCall();

  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_CHARS) return reply({ error: "That transcript is too large." }, 413);
  let body: { lines?: unknown } | null = null;
  try {
    body = JSON.parse(text);
  } catch {}

  const now = new Date();
  try {
    const store = voiceStore();
    const session = await store.session(claim.sessionId);
    if (!session) return noCall();
    if (!callOpen(session, now, TRANSCRIPT_GRACE_MS)) return reply({ error: "This call has ended.", reason: "ended" }, 403);
    const lines = cleanLines(body?.lines, now);
    await store.addLines(session.id, lines, now);
    return reply({ added: lines.length });
  } catch (err) {
    console.error("[voice/transcript]", err);
    return reply({ error: SNAG }, 502);
  }
}

export async function GET(request: Request) {
  if (!voiceConfigured()) return notReady();
  const claim = verifySessionToken(bearerToken(request));
  if (!claim) return noCall();
  try {
    const transcript = await voiceStore().transcript(claim.sessionId);
    return reply({ lines: transcript?.lines ?? [] });
  } catch (err) {
    console.error("[voice/transcript]", err);
    return reply({ error: SNAG }, 502);
  }
}
