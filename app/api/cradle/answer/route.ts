import { catalogConfigured } from "@/lib/catalog";
import { ask, type AnswerEvent } from "@/lib/cradle/agent";
import { cradleConfigured } from "@/lib/cradle/book";
import { specData, specText } from "@/lib/cradle/ui";
import { reportUsage } from "@/lib/cradle/usage";
import { speedBump } from "@/lib/speed-bump";

/**
 * One shopper request, answered as it forms (B21): newline-delimited JSON
 * events (the plan's fields as the model writes them, the products the moment
 * the kernel returns them, then the final answer with its trace), so the
 * screen fills in place instead of waiting for the whole answer.
 *
 * `?format=text` returns the same answer rendered as plain text from its spec
 * (B8): the channel for chat and voice.
 */
export const maxDuration = 60;

const limited = speedBump(60, 10 * 60_000);

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false; // "null" or garbage
  }
}

export async function POST(request: Request) {
  if (!cradleConfigured() || !catalogConfigured()) return Response.json({ error: "Cradle mode isn't set up." }, { status: 503 });
  // Only the store's own pages (or a non-browser client such as curl) may call it.
  if (!sameOrigin(request)) return Response.json({ error: "Not from this store." }, { status: 403 });
  if (limited(request)) return Response.json({ error: "That's a lot of searches! Give it a few minutes." }, { status: 429 });

  const body = (await request.json().catch(() => null)) as { request?: unknown } | null;
  const q = typeof body?.request === "string" ? body.request.trim().slice(0, 500) : "";
  if (!q) return Response.json({ error: "Ask for something." }, { status: 400 });

  const metered = (a: Awaited<ReturnType<typeof ask>>) => {
    if (a.trace.model) reportUsage("search", { ...a.trace, model: a.trace.model });
    return a;
  };

  if (new URL(request.url).searchParams.get("format") === "text") {
    try {
      const a = metered(await ask(q));
      return new Response(specText(a.spec, specData(a.items)), { headers: { "content-type": "text/plain; charset=utf-8" } });
    } catch (err) {
      console.error("[cradle] answer:", err instanceof Error ? err.message : err);
      return new Response("The store couldn't answer that just now.", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  }

  const encoder = new TextEncoder();
  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AnswerEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          // the shopper left: keep going, so the call is metered and logged
        }
      };
      try {
        metered(await ask(q, undefined, send));
      } catch (err) {
        console.error("[cradle] answer:", err instanceof Error ? err.message : err);
        send({ type: "error", at: Date.now() - started, message: "The store couldn't answer that just now." });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
