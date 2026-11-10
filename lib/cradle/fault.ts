import "server-only";

import { after } from "next/server";

import { cradleConfigured, cradleHeaders, cradleUrl } from "./book";

/**
 * Model health (Accelerator B18): when a model call fails because of the model
 * account (out of credit, key rejected, unknown model, rate limit, overload,
 * outage), the app tells the Accelerator, so the owner sees "AI unavailable"
 * with the fix on the Policy dial and the Health page instead of finding it in
 * the logs. The Accelerator re-classifies every report; this copy only decides
 * what's worth sending (and lets the gate stop a proof without a false verdict).
 */

export type FaultKind = "billing" | "auth" | "model" | "rate_limit" | "overloaded" | "unavailable";
export type Fault = { kind: FaultKind; status: number | null; message: string };

const LABEL: Record<FaultKind, string> = {
  billing: "out of credit",
  auth: "API key rejected",
  model: "model not found",
  rate_limit: "rate limited",
  overloaded: "provider overloaded",
  unavailable: "provider unreachable",
};
export const faultLabel = (f: Fault) => LABEL[f.kind];

/** Is this error a model-account problem? (The SDK's errors carry an HTTP status; connection errors don't.) */
export function modelFault(err: unknown): Fault | null {
  if (!(err instanceof Error)) return null;
  const raw = (err as Error & { status?: unknown }).status;
  const status = typeof raw === "number" ? raw : null;
  const m = err.message.toLowerCase();
  const kind: FaultKind | null =
    status === 402 || /credit balance|insufficient[_ ]quota|billing|exceeded your current quota/.test(m) ? "billing"
    : status === 401 || status === 403 || /invalid x-api-key|authentication_error|permission_error|invalid api key/.test(m) ? "auth"
    : /model[^.]{0,40}(not found|does not exist)|not_found_error.*model/.test(m) ? "model"
    : status === 429 || /rate[_ ]limit/.test(m) ? "rate_limit"
    : status === 529 || /overloaded/.test(m) ? "overloaded"
    : (status != null && status >= 500) || err.name === "APIConnectionError" || err.name === "APIConnectionTimeoutError" || /connection error|fetch failed|econnreset/.test(m) ? "unavailable"
    : null;
  return kind ? { kind, status, message: err.message.slice(0, 1000) } : null;
}

/** A model-account failure that should stop the conformance gate without a verdict: nothing was judged. */
export class ModelUnavailable extends Error {
  constructor(readonly fault: Fault) {
    super(`AI ${faultLabel(fault)}: ${fault.message}`);
    this.name = "ModelUnavailable";
  }
}

// One report per kind and role per minute per server instance: a broken key fails every request.
const g = globalThis as unknown as { cradleFaultSent?: Map<string, number> };

/** Report a failed model call (if it's a model-account problem). Never blocks or throws. Returns the fault, if it was one. */
export function reportFault(role: string, model: string, err: unknown): Fault | null {
  const fault = modelFault(err);
  if (!fault || !cradleConfigured() || process.env.NODE_ENV === "test") return fault;
  g.cradleFaultSent ??= new Map();
  const key = `${fault.kind}:${role}`;
  if (Date.now() - (g.cradleFaultSent.get(key) ?? 0) < 60_000) return fault;
  g.cradleFaultSent.set(key, Date.now());
  console.error(`[cradle] model ${faultLabel(fault)} (${role}, ${model}): ${fault.message}`);
  const send = async () => {
    try {
      const res = await fetch(cradleUrl("/api/runtime/health"), {
        method: "POST",
        headers: cradleHeaders(),
        body: JSON.stringify({ faults: [{ role, model, status: fault.status, message: fault.message }] }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) console.error(`[cradle] health report: the Accelerator answered ${res.status}`);
    } catch (e) {
      console.error("[cradle] health report:", e instanceof Error ? e.message : e);
    }
  };
  try {
    after(send);
  } catch {
    void send();
  }
  return fault;
}
