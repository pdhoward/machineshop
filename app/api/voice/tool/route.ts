import { runTool } from "@/lib/assistant-tools";
import { catalogConfigured } from "@/lib/catalog";
import type { ProductCard } from "@/lib/product";
import { callOpen, voiceConfigured } from "@/lib/voice";
import { voiceStore } from "@/lib/voice-store";
import { bearerToken, verifySessionToken } from "@/lib/voice-token";

/**
 * Runs one catalog skill for the voice model during a live call.
 * POST `{ name, arguments }` with `Authorization: Bearer <token>`. The browser
 * forwards the model's function call here and hands `output` back to it.
 * Refuses missing or forged tokens, and calls that ended or passed 5:00 (the
 * server-side cap). `show_products` also returns the cards for the panel.
 */

const MAX_BODY_CHARS = 8_000;

const SNAG = "Couldn't reach the catalog. Try again in a moment.";

const ready = () => voiceConfigured() && catalogConfigured();

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The model sends arguments as a JSON string; accept an object too. Anything else is no arguments. */
function parseArgs(raw: unknown): Record<string, unknown> {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function POST(request: Request) {
  if (!ready()) return reply({ error: "Talk isn't set up yet." }, 503);
  const claim = verifySessionToken(bearerToken(request));
  if (!claim) return reply({ error: "No active call.", reason: "no_call" }, 401);

  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_CHARS) return reply({ error: "That request is too large." }, 413);
  let body: { name?: unknown; arguments?: unknown } | null = null;
  try {
    body = JSON.parse(text);
  } catch {}
  const name = typeof body?.name === "string" ? body.name : "";
  const args = parseArgs(body?.arguments);

  try {
    const session = await voiceStore().session(claim.sessionId);
    if (!session) return reply({ error: "No active call.", reason: "no_call" }, 401);
    if (!callOpen(session, new Date())) return reply({ error: "This call has ended.", reason: "ended" }, 403);

    const shown: ProductCard[] = [];
    const output = await runTool(name, args, shown);
    return reply(name === "show_products" ? { output, products: shown } : { output });
  } catch (err) {
    console.error("[voice/tool]", err);
    return reply({ error: SNAG }, 502);
  }
}
