import "server-only";

import Anthropic from "@anthropic-ai/sdk";

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

export async function jsonCall<T>(opts: {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
  /** Fast calls skip thinking (allowed at effort high or below on Haiku). */
  think?: boolean;
}): Promise<Call<T>> {
  const started = Date.now();
  const res = await anthropic().messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4000,
    ...(opts.think === false ? { thinking: { type: "disabled" as const } } : {}),
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.user }],
    output_config: { effort: opts.effort, format: { type: "json_schema", schema: opts.schema } },
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const [pin, pout] = PRICES[opts.model] ?? [0, 0];
  const tokensIn = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
  const costUsd = (res.usage.input_tokens * pin + (res.usage.cache_read_input_tokens ?? 0) * pin * 0.1 + (res.usage.cache_creation_input_tokens ?? 0) * pin * 1.25 + res.usage.output_tokens * pout) / 1e6;
  return { data: JSON.parse(text) as T, model: opts.model, ms: Date.now() - started, tokensIn, tokensOut: res.usage.output_tokens, costUsd };
}
