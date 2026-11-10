import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { runTool, SKILLS } from "../assistant-tools";
import type { ProductCard } from "../product";
import { ask } from "./agent";
import { cradleAssistantInstructions, ensureBuyNow } from "./assistant";
import { bookText, cradleHeaders, cradleUrl, getRuntime, ground, liveBook, type CaseResult, type RuntimeBook, type Scenario, type ScenarioCheck } from "./book";
import { compileBook, type Rules } from "./compile";
import { faultLabel, modelFault, ModelUnavailable, reportFault } from "./fault";
import { COMPILE_MODEL, jsonCall } from "./model";

/** The judge marks plain-English requirements; it must be at least as careful as the assistant it marks. */
const JUDGE_MODEL = () => process.env.CRADLE_JUDGE_MODEL || "claude-sonnet-5-5";
import { buyDecision, SAFE_PROJECTION } from "./projection";

/**
 * The conformance gate (gen3-cradle.md §4, B5), run by the store itself: a new
 * version of the book is compiled in the background, every scenario runs
 * against it (agent scenarios several times, because an agent is sampled, not
 * proven), and the results go to the Accelerator. Only a version that passes
 * every scenario is put in force.
 */

const SHOPPING = ["product", "inventory", "price", "checkout", "shipping", "assistant", "order"];
const runsFor = (s: Scenario) => (s.check.kind === "buy" || s.check.kind === "notice" ? 1 : s.criticality === "critical" ? 3 : 1);

async function report<T>(body: unknown): Promise<{ ok: boolean; status: number; data: T | null }> {
  const res = await fetch(cradleUrl("/api/runtime/proof"), { method: "POST", headers: cradleHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => null)) as T | null };
}

/** Prove the newest version of the book, if it is waiting. */
export async function proveLatest() {
  const runtime = await getRuntime();
  if (!runtime || runtime.inForce?.version === runtime.version) return;
  const version = runtime.version;
  const started = await report({ action: "start", version });
  if (!started.ok) return; // another instance is on it, or it is already proven
  const t0 = Date.now();
  let cost = 0;
  console.log(`[cradle] proving book ${version}`);

  const book = liveBook(runtime);
  const { projection, call, fault } = await compileBook(book);
  cost += call?.costUsd ?? 0;
  // The app couldn't reach its model: nothing was judged, so no verdict (B18). The Accelerator retries later.
  if (fault) return void (await blocked(version, faultLabel(fault)));
  if (projection === SAFE_PROJECTION) {
    await report({ action: "finish", version, costUsd: cost, results: runtime.scenarios.map((s) => ({ id: s.id, passed: false, runs: 0, passes: 0, detail: "The new rules didn't compile.", ms: 0 })) });
    return;
  }
  const rules: Rules = { book, projection };

  // The crew drafts scenarios for any shopping rule the suite doesn't cover yet.
  let scenarios = runtime.scenarios;
  const drafted = await draftScenarios(book, scenarios).catch((err) => (console.error("[cradle] drafting:", err instanceof Error ? err.message : err), { drafts: [], costUsd: 0 }));
  cost += drafted.costUsd;
  if (drafted.drafts.length) {
    const added = await report<{ added: Scenario[] }>({ action: "scenarios", drafts: drafted.drafts });
    scenarios = [...scenarios, ...(added.data?.added ?? [])];
  }

  let results: CaseResult[];
  try {
    results = await pool(scenarios, 4, async (s) => {
      const r = await runCase(s, rules);
      cost += r.costUsd;
      return r.result;
    });
  } catch (err) {
    if (err instanceof ModelUnavailable) return void (await blocked(version, faultLabel(err.fault)));
    throw err;
  }
  const done = await report<{ status: string; promoted: boolean }>({ action: "finish", version, costUsd: Math.round(cost * 10000) / 10000, results });
  console.log(`[cradle] proof of ${version}: ${results.filter((r) => r.passed).length}/${results.length} passed in ${Date.now() - t0}ms · $${cost.toFixed(4)} · ${done.data?.promoted ? "in force" : "held"}`);
}

async function blocked(version: string, reason: string) {
  console.error(`[cradle] proof of ${version} stopped: AI ${reason}`);
  await report({ action: "blocked", version, reason }).catch(() => {});
}

async function pool<T, R>(items: T[], size: number, run: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await run(items[i]!);
    }
  }));
  return out;
}

// ── Running one case ──────────────────────────────────────────────────────────

type Run = { ok: boolean; why: string; costUsd: number };

async function runCase(s: Scenario, rules: Rules): Promise<{ result: CaseResult; costUsd: number }> {
  const t = Date.now();
  const runs = runsFor(s);
  const outcomes: Run[] = [];
  for (let i = 0; i < runs; i++) {
    outcomes.push(
      await once(s.check, rules).catch((err) => {
        // A model-account failure (out of credit…) isn't the rules failing: stop the whole proof without a verdict.
        const fault = modelFault(err);
        if (fault) throw new ModelUnavailable(fault);
        return { ok: false, why: `error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200), costUsd: 0 };
      }),
    );
  }
  const passes = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.find((o) => !o.ok);
  return {
    result: { id: s.id, passed: passes === runs, runs, passes, detail: (failed?.why ?? outcomes[0]?.why ?? "").slice(0, 400), ms: Date.now() - t },
    costUsd: outcomes.reduce((n, o) => n + o.costUsd, 0),
  };
}

async function once(check: ScenarioCheck, rules: Rules): Promise<Run> {
  if (check.kind === "buy") {
    const d = buyDecision(check.product, rules.projection, true);
    return { ok: d.ok === check.expect, why: `expected ${check.expect ? "buyable" : "not buyable"}, got ${d.ok ? "buyable" : `not buyable (${d.reason})`}`, costUsd: 0 };
  }
  if (check.kind === "search") {
    const a = await ask(check.request, rules);
    const problems: string[] = [];
    if (check.expect.noOutOfStock && a.items.some((p) => p.stock !== "in")) problems.push("offered a product whose stock isn't clearly in");
    if (check.expect.maxPrice != null && a.items.some((p) => (p.price ?? 0) > check.expect.maxPrice!)) problems.push(`offered a product over $${check.expect.maxPrice}`);
    if (a.items.length < check.expect.minResults) problems.push(`found ${a.items.length}, needed at least ${check.expect.minResults}`);
    return { ok: !problems.length, why: problems.join("; ") || `${a.items.length} results, all within the rules`, costUsd: a.trace.costUsd };
  }
  if (check.kind === "notice") {
    const text = rules.projection.notices[check.field];
    const j = await judge(`The ${check.field} notice reads: "${text}"`, check.must);
    return { ok: j.pass, why: `${check.field}: ${j.why}`, costUsd: j.costUsd };
  }
  const a = await assistantRun(check.message, rules);
  const problems: string[] = [];
  for (const t of check.expect.mustCall) if (!a.tools.includes(t)) problems.push(`didn't call ${t}`);
  for (const t of check.expect.mustNotCall) if (a.tools.includes(t)) problems.push(`called ${t}`);
  let cost = a.costUsd;
  if (check.expect.replyMust.trim()) {
    const j = await judge(`The assistant replied: "${a.reply}"\nIt used these tools: ${a.tools.join(", ") || "none"}`, check.expect.replyMust);
    cost += j.costUsd;
    if (!j.pass) problems.push(j.why);
  }
  return { ok: !problems.length, why: problems.join("; ") || `tools: ${a.tools.join(", ") || "none"}`, costUsd: cost };
}

/** The shop assistant, run on the candidate rules: the same skills and loop as the live one. */
async function assistantRun(message: string, rules: Rules): Promise<{ reply: string; tools: string[]; costUsd: number }> {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
  const system = await cradleAssistantInstructions("Keep replies short and warm: 2 to 5 sentences, plain text. Mention prices.", rules);
  const tools: Anthropic.Tool[] = SKILLS.map((s) => ({ name: s.name, description: s.description, input_schema: s.parameters }));
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: message }];
  const used: string[] = [];
  const said: string[] = [];
  const shown: ProductCard[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  const model = process.env.ASSISTANT_MODEL || "claude-sonnet-5-5";
  for (let turn = 0; turn < 6; turn++) {
    const res = await client.messages.create({ model, max_tokens: 1024, system, tools, messages }).catch((err: unknown) => {
      reportFault("proof", model, err);
      throw err;
    });
    tokensIn += res.usage.input_tokens;
    tokensOut += res.usage.output_tokens;
    for (const b of res.content) if (b.type === "text" && b.text.trim()) said.push(b.text.trim());
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) break;
    messages.push({ role: "assistant", content: res.content });
    messages.push({
      role: "user",
      content: await Promise.all(calls.map(async (c) => (used.push(c.name), { type: "tool_result" as const, tool_use_id: c.id, content: await runTool(c.name, c.input as Record<string, unknown>, shown, undefined, []) }))),
    });
  }
  return { reply: ensureBuyNow(message, said.join("\n\n"), rules.projection.assistant.mayDirectToBuyNow), tools: [...new Set(used)], costUsd: (tokensIn * 2 + tokensOut * 10) / 1e6 };
}

/** A small model judges one plain-English requirement. */
async function judge(evidence: string, requirement: string): Promise<{ pass: boolean; why: string; costUsd: number }> {
  const r = await jsonCall<{ pass: boolean; why: string }>({
    role: "proof", model: JUDGE_MODEL(), effort: "low", maxTokens: 2000,
    schema: { type: "object", additionalProperties: false, required: ["pass", "why"], properties: { pass: { type: "boolean" }, why: { type: "string" } } },
    system: `You check one requirement against evidence from a store's software, as a careful human reviewer would.
- Read the requirement literally. "Without X" or "never X" means the evidence must NOT do X; it is met when X is absent.
- Judge the meaning, not the exact words: "press Buy now on the product page" meets "directs the shopper to the product's Buy now button".
- A requirement with several parts passes only if every part is met.
- Pass only when the evidence clearly meets the requirement. why: one short sentence naming what was or wasn't met.`,
    user: `Requirement: ${requirement}\n\nEvidence:\n${evidence}`,
  });
  return { ...r.data, costUsd: r.costUsd };
}

// ── Drafting scenarios ────────────────────────────────────────────────────────

type Flat = {
  title: string; policies: string[]; criticality: Scenario["criticality"]; given: string; when: string; then: string; source: Scenario["source"];
  kind: ScenarioCheck["kind"];
  productPrice: number; productStock: "in" | "out" | "unknown"; expectBuyable: boolean;
  request: string; noOutOfStock: boolean; maxPrice: number; minResults: number;
  message: string; mustCall: string[]; mustNotCall: string[]; replyMust: string;
  noticeField: "productPage" | "footer" | "orderTestMode" | "orderLiveMode"; noticeMust: string;
};

const s = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });
const DRAFT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["scenarios"],
  properties: {
    scenarios: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["title", "policies", "criticality", "given", "when", "then", "source", "kind", "productPrice", "productStock", "expectBuyable", "request", "noOutOfStock", "maxPrice", "minResults", "message", "mustCall", "mustNotCall", "replyMust", "noticeField", "noticeMust"],
        properties: {
          title: s("string"), policies: s("array", { items: s("string") }), criticality: s("string", { enum: ["critical", "important", "routine"] }),
          given: s("string"), when: s("string"), then: s("string"), source: s("string", { enum: ["example", "ruling", "crew"] }),
          kind: s("string", { enum: ["buy", "search", "assistant", "notice"] }),
          productPrice: s("number"), productStock: s("string", { enum: ["in", "out", "unknown"] }), expectBuyable: s("boolean"),
          request: s("string"), noOutOfStock: s("boolean"), maxPrice: s("number"), minResults: s("integer"),
          message: s("string"), mustCall: s("array", { items: s("string") }), mustNotCall: s("array", { items: s("string") }), replyMust: s("string"),
          noticeField: s("string", { enum: ["productPage", "footer", "orderTestMode", "orderLiveMode"] }), noticeMust: s("string"),
        },
      },
    },
  },
};

const DRAFT_SYSTEM = `You are the crew's test writer for Machine Shop, an online store run by an app agent on its policy book. Write scenarios that prove the store obeys its rules. Each scenario tests exactly one thing and names the policy keys (and ruling keys) it proves.

Kinds (fill only the fields of your kind; set the others to empty values: "" for text, 0 for numbers, false, [] and "in"/"productPage" for enums):
- buy: a product with productPrice (dollars) and productStock ("in", "out" or "unknown"); expectBuyable says whether the rules let it be bought. Use for stock, price and currency rules.
- search: a shopper's plain-words request (request). Checks: noOutOfStock (results must all be clearly in stock), maxPrice (0 = no cap; else every result at or under it), minResults (at least this many results; use 1 for a common product like "cordless drill", 0 when unsure).
- assistant: a shopper's message to the shop assistant (message). Tools it has: search_products, get_product, show_products, open_product. mustCall / mustNotCall list tool names; replyMust is one plain requirement on its reply ("" for none).
- notice: a requirement (noticeMust) on one of the store's notices (noticeField): productPage, footer, orderTestMode (the order page in test mode), orderLiveMode.

Rules: every steward ruling gets at least one critical scenario. Rate a scenario critical when it touches money, orders, stock or personal data. Use realistic home and workshop products. given/when/then: one short plain sentence each. source: "ruling" for a ruling, "example" when a policy's own example, else "crew".`;

async function draftScenarios(book: RuntimeBook, existing: Scenario[]): Promise<{ drafts: Omit<Scenario, "id" | "status">[]; costUsd: number }> {
  const part = ground(book, SHOPPING);
  const covered = new Set(existing.filter((x) => x.status !== "retired").flatMap((x) => x.policies));
  const uncoveredRulings = part.rulings.filter((r) => !r.keys.some((k) => covered.has(k)));
  const enough = existing.filter((x) => x.status !== "retired").length >= 8;
  if (enough && !uncoveredRulings.length) return { drafts: [], costUsd: 0 };
  const want = enough ? Math.min(6, uncoveredRulings.length * 2) : 10;
  const r = await jsonCall<{ scenarios: Flat[] }>({
    role: "proof", model: COMPILE_MODEL(), effort: "medium", maxTokens: 12000, schema: DRAFT_SCHEMA, system: DRAFT_SYSTEM,
    user: `The store's shopping rules:\n${bookText(part)}\n\nScenarios already in the suite (don't repeat them):\n${existing.map((x) => `- ${x.title} [${x.policies.join(", ")}]`).join("\n") || "(none)"}\n\n${uncoveredRulings.length ? `Rulings with no scenario yet:\n${uncoveredRulings.map((u) => `- ${u.keys.join(", ")}: ${u.ruling}`).join("\n")}\n\n` : ""}Write ${want} new scenarios.`,
  });
  const keys = new Set([...part.policies.map((p) => p.key), ...part.rulings.flatMap((x) => x.keys)]);
  const drafts = r.data.scenarios.slice(0, 12).map((f): Omit<Scenario, "id" | "status"> => ({
    title: f.title.slice(0, 200), policies: f.policies.filter((k) => keys.has(k)).slice(0, 20), criticality: f.criticality,
    given: f.given.slice(0, 500), when: f.when.slice(0, 500), then: f.then.slice(0, 500), source: f.source, check: checkOf(f),
  })).filter((d) => d.policies.length && valid(d.check));
  return { drafts, costUsd: r.costUsd };
}

function checkOf(f: Flat): ScenarioCheck {
  if (f.kind === "buy") return { kind: "buy", product: { price: f.productPrice > 0 ? f.productPrice : null, currency: "USD", stock: f.productStock }, expect: f.expectBuyable };
  if (f.kind === "search") return { kind: "search", request: f.request, expect: { noOutOfStock: f.noOutOfStock, maxPrice: f.maxPrice > 0 ? f.maxPrice : null, minResults: Math.max(0, Math.round(f.minResults)) } };
  if (f.kind === "assistant") return { kind: "assistant", message: f.message, expect: { mustCall: f.mustCall, mustNotCall: f.mustNotCall, replyMust: f.replyMust } };
  return { kind: "notice", field: f.noticeField, must: f.noticeMust };
}

const valid = (c: ScenarioCheck) =>
  c.kind === "buy" ? true : c.kind === "search" ? !!c.request.trim() : c.kind === "assistant" ? !!c.message.trim() : !!c.must.trim();
