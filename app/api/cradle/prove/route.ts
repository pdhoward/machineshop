import { after } from "next/server";

import { cradleConfigured } from "@/lib/cradle/book";
import { sameToken } from "@/lib/cradle/token";

/**
 * POST /api/cradle/prove — the Accelerator says the rules changed: prove them
 * now (the conformance gate, B5), instead of waiting for the next page view.
 * Only the Accelerator can call it: the bearer must be this store's own
 * CRADLE_TOKEN. The proof runs after the 202 is sent.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!cradleConfigured()) return Response.json({ error: "Cradle mode is off." }, { status: 503 });
  const got = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (!sameToken(got, process.env.CRADLE_TOKEN)) return Response.json({ error: "Not allowed." }, { status: 401 });
  after(async () => {
    const { proveLatest } = await import("@/lib/cradle/conformance");
    await proveLatest().catch((err) => console.error("[cradle] proof:", err instanceof Error ? err.message : err));
  });
  return Response.json({ accepted: true }, { status: 202 });
}
