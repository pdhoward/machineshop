import { OWNER_PAGE_SIZE, pageNumber, transcriptsSince, voiceConfigured } from "@/lib/voice";
import { isOwner } from "@/lib/voice-caller";
import { voiceStore } from "@/lib/voice-store";

/**
 * The owner's list of saved calls: GET `?page=N`. Needs the owner cookie
 * (app/api/voice/owner/session). Covers only the last 30 days, newest first,
 * 20 per page. Each item opens through ./[id].
 */

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  if (!voiceConfigured()) return reply({ error: "Talk isn't set up yet." }, 503);
  const now = new Date();
  if (!isOwner(request, now)) return reply({ error: "Sign in with the owner code.", reason: "signed_out" }, 401);

  const page = pageNumber(new URL(request.url).searchParams.get("page"));
  try {
    const { items, total } = await voiceStore().listTranscripts({ since: transcriptsSince(now), page, size: OWNER_PAGE_SIZE });
    return reply({
      items: items.map((i) => ({ sessionId: i.sessionId, createdAt: i.createdAt.toISOString() })),
      total,
      page,
      pageSize: OWNER_PAGE_SIZE,
      pages: Math.max(1, Math.ceil(total / OWNER_PAGE_SIZE)),
    });
  } catch (err) {
    console.error("[voice/owner/transcripts]", err);
    return reply({ error: "Couldn't load the saved calls. Try again in a moment." }, 502);
  }
}
