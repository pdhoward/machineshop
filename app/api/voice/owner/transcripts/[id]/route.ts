import { voiceConfigured, withinKeep } from "@/lib/voice";
import { isOwner } from "@/lib/voice-caller";
import { voiceStore } from "@/lib/voice-store";

/**
 * One saved call's transcript for the owner: GET. Needs the owner cookie, and
 * only calls from the last 30 days are shown, even if the auto-delete is late.
 */

const MAX_ID_CHARS = 100;

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const notFound = () => reply({ error: "That call isn't saved." }, 404);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!voiceConfigured()) return reply({ error: "Talk isn't set up yet." }, 503);
  const now = new Date();
  if (!isOwner(request, now)) return reply({ error: "Sign in with the owner code.", reason: "signed_out" }, 401);

  const { id } = await params;
  if (!id || id.length > MAX_ID_CHARS) return notFound();
  try {
    const transcript = await voiceStore().transcript(id);
    if (!transcript || !withinKeep(transcript.createdAt, now)) return notFound();
    return reply({ sessionId: transcript.sessionId, createdAt: transcript.createdAt.toISOString(), lines: transcript.lines });
  } catch (err) {
    console.error("[voice/owner/transcripts]", err);
    return reply({ error: "Couldn't load that call. Try again in a moment." }, 502);
  }
}
