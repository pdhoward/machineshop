import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { reportFault } from "./fault";

/**
 * The app agent's model calls (cradle mode). Every call returns JSON that
 * matches a schema (structured outputs), plus what it cost and how long it
 * took, so the Why drawer can show the price of each decision.
 */

/** The fast decision on every request. */
export const FAST_MODEL = () => process.env.CRADLE_FAST_MODEL || "claude-haiku-5-5";
/** Compiling the book into runtime settings: once per book version. */
export const COMPILE_MODEL = () => process.env.CRADLE_COMPILE_MODEL || "claude-sonnet-5-5";

/** $ per million tokens, input / output (Anthropic list prices). */
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};

let client: Anthropic | null = null;
const anthropic = () => {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  return (client ??= new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}));
};

export type Call<T> = { data: T; model: string; ms: number; tokensIn: number; tokensOut: number; costUsd: number };

export type JsonOpts = {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
  /** Fast calls skip thinking (allowed at effort high or below on Haiku). */
  think?: boolean;
  /** What the call is for, named in model-health reports (search, compile, proof). */
  role: string;
};

const params = (opts: JsonOpts) => ({
  model: opts.model,
  max_tokens: opts.maxTokens ?? 4000,
  ...(opts.think === false ? { thinking: { type: "disabled" as const } } : {}),
  system: [{ type: "text" as const, text: opts.system, cache_control: { type: "ephemeral" as const } }],
  messages: [{ role: "user" as const, content: opts.user }],
  output_config: { effort: opts.effort, format: { type: "json_schema" as const, schema: opts.schema } },
});

function finish<T>(opts: JsonOpts, res: Anthropic.Message, started: number): Call<T> {
  if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (res.stop_reason === "max_tokens") throw new Error(`The model ran out of room (${opts.maxTokens ?? 4000} tokens) before finishing its answer.`);
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return { data: JSON.parse(text) as T, model: opts.model, ms: Date.now() - started, ...costOf(opts.model, res.usage) };
}

const fault = (opts: JsonOpts) => (err: unknown) => {
  reportFault(opts.role, opts.model, err); // out of credit, bad key…: the Accelerator shows it (B18)
  throw err;
};

export async function jsonCall<T>(opts: JsonOpts): Promise<Call<T>> {
  const started = Date.now();
  const res = await anthropic().messages.create(params(opts)).catch(fault(opts));
  return finish<T>(opts, res, started);
}

/**
 * The same call, streamed (B21): `onText` sees the JSON written so far after
 * every delta, so the caller can act on finished fields (start the search,
 * show the headline) while the model is still writing the rest. A throwing
 * `onText` never breaks the call.
 */
export async function jsonStream<T>(opts: JsonOpts & { onText: (soFar: string) => void }): Promise<Call<T>> {
  const started = Date.now();
  const stream = anthropic().messages.stream(params(opts));
  stream.on("text", (_delta, soFar) => {
    try {
      opts.onText(soFar);
    } catch (err) {
      console.error("[cradle] stream reader:", err instanceof Error ? err.message : err);
    }
  });
  const res = await stream.finalMessage().catch(fault(opts));
  return finish<T>(opts, res, started);
}

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

/** What one call cost at list prices: cache reads at 0.1x, cache writes at 1.25x (5-minute TTL). */
export function costOf(model: string, u: Usage): { tokensIn: number; tokensOut: number; costUsd: number } {
  const [pin, pout] = PRICES[model] ?? [0, 0];
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  return {
    tokensIn: u.input_tokens + read + write,
    tokensOut: u.output_tokens,
    costUsd: (u.input_tokens * pin + read * pin * 0.1 + write * pin * 1.25 + u.output_tokens * pout) / 1e6,
  };
}
