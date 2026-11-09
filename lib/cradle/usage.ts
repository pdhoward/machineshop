import "server-only";

import { after } from "next/server";

import { cradleConfigured, cradleHeaders, cradleUrl } from "./book";

/**
 * The app reports its own model calls to the Accelerator (POST /api/runtime/usage),
 * so the site's Spend page shows what shoppers' searches, rule compiles and the
 * assistant cost. Never blocks or fails a request: it runs after the response,
 * and a lost report only leaves a gap in the meter. The conformance gate's
 * calls aren't reported here: each proof run reports its own cost.
 */
export type UsageRole = "search" | "compile" | "assistant";

export function reportUsage(role: UsageRole, call: { model: string; tokensIn: number; tokensOut: number; costUsd: number }) {
  if (!cradleConfigured() || process.env.NODE_ENV === "test") return;
  const send = async () => {
    try {
      const res = await fetch(cradleUrl("/api/runtime/usage"), {
        method: "POST",
        headers: cradleHeaders(),
        body: JSON.stringify({ events: [{ role, model: call.model, tokensIn: call.tokensIn, tokensOut: call.tokensOut, costUsd: Math.round(call.costUsd * 1e6) / 1e6 }] }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) console.error(`[cradle] usage report: the Accelerator answered ${res.status}`);
    } catch (err) {
      console.error("[cradle] usage report:", err instanceof Error ? err.message : err);
    }
  };
  try {
    after(send); // inside a request: after the response is sent
  } catch {
    void send(); // outside a request (e.g. a compile started by a proof)
  }
}
