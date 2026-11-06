import "server-only";

import { randomUUID } from "node:crypto";

import { listDepartments, search } from "../catalog";
import { stripeReady } from "../stripe";
import type { ProductCard } from "../product";
import { bookText, ground } from "./book";
import { compiledRules } from "./compile";
import { FAST_MODEL, jsonCall } from "./model";
import { buyDecision, type BuyDecision, type Projection } from "./projection";

/**
 * The app agent (gen3-cradle.md §1.4): a shopper's request, carried out on
 * the rules in force. Route and Ground pick the policies that apply; the model
 * Decides what to look for and how to present it; the catalog kernel Executes
 * the search; the projections decide what can be bought; the page Renders from
 * tested components; and everything is Recorded in a trace.
 */

export type Plan = {
  intent: "find" | "compare" | "one_product" | "buy" | "other";
  query: string;
  category: string;
  minPrice: number;
  maxPrice: number;
  inStockOnly: boolean;
  layout: "grid" | "compare" | "single";
  headline: string;
  explanation: string;
  rulesApplied: string[];
  followUp: string;
};

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "query", "category", "minPrice", "maxPrice", "inStockOnly", "layout", "headline", "explanation", "rulesApplied", "followUp"],
  properties: {
    intent: { type: "string", enum: ["find", "compare", "one_product", "buy", "other"] },
    query: { type: "string" },
    category: { type: "string" },
    minPrice: { type: "number" },
    maxPrice: { type: "number" },
    inStockOnly: { type: "boolean" },
    layout: { type: "string", enum: ["grid", "compare", "single"] },
    headline: { type: "string" },
    explanation: { type: "string" },
    rulesApplied: { type: "array", items: { type: "string" } },
    followUp: { type: "string" },
  },
};

/** The concepts a shopping request can touch (Route): the rest of the book (voice, data retention…) stays out of the context. */
const SHOPPING = ["product", "inventory", "price", "checkout", "shipping", "assistant", "order"];

export type Stage = { name: "route" | "ground" | "decide" | "execute" | "render"; ms: number; detail: string };
export type Trace = {
  id: string;
  at: string;
  request: string;
  bookVersion: string | null;
  compiled: boolean;
  stages: Stage[];
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  totalMs: number;
  rules: { key: string; text: string }[];
};
export type Item = ProductCard & { buy: BuyDecision };
export type Answer = { plan: Plan; items: Item[]; total: number; trace: Trace; projection: Projection };

const SYSTEM = (departments: string) => `You are the app agent of Machine Shop, an online store of about 10,000 home and workshop products. A shopper typed a request into the store's search box. Decide what to look for in the catalog and how to present it, following the store's rules below.

Return:
- query: 1 to 4 short catalog keywords (nouns a product name or category would contain, e.g. "cordless drill"). Never put prices, adjectives like "cheap", or stock words in query.
- category: one department from this list when the request clearly belongs to it, else "": ${departments}
- minPrice / maxPrice: dollars, 0 when not stated.
- inStockOnly: true when the shopper asks for things available now, or when the rules say out-of-stock products must not be offered.
- layout: "compare" when the shopper wants to compare or choose between options, "single" when they name one specific product, else "grid".
- headline: a short title for the results. explanation: one or two sentences telling the shopper what you looked for and which store rules shaped the results, in plain words (no policy keys).
- rulesApplied: the keys of the policies or rulings that shaped this decision (only keys that appear below).
- followUp: one short suggestion of what the shopper could ask next.`;

export async function ask(request: string): Promise<Answer> {
  const t0 = Date.now();
  const stages: Stage[] = [];
  const mark = (name: Stage["name"], since: number, detail: string) => stages.push({ name, ms: Date.now() - since, detail });

  // Route: the request is shopping; ground on the shopping concepts.
  let t = Date.now();
  const [{ book, projection, compiled }, departments] = await Promise.all([compiledRules(), listDepartments().catch(() => [])]);
  mark("route", t, `shopping request · concepts: ${SHOPPING.join(", ")}`);

  t = Date.now();
  const part = book ? ground(book, SHOPPING) : { policies: [], rulings: [] };
  mark("ground", t, book ? `${part.policies.length} of ${book.policies.length} policies and ${part.rulings.length} rulings, book ${book.version}` : "no book: safe settings");

  t = Date.now();
  const call = await jsonCall<Plan>({
    model: FAST_MODEL(), effort: "low", think: false, maxTokens: 1200, schema: PLAN_SCHEMA,
    system: `${SYSTEM(departments.map((d) => d.name).join(", "))}\n\nThe store's rules in force:\n${bookText(part) || "(none available: be cautious)"}`,
    user: request.slice(0, 500),
  });
  const plan = call.data;
  mark("decide", t, `${call.model} · intent ${plan.intent} · "${plan.query}"${plan.category ? ` in ${plan.category}` : ""}`);

  t = Date.now();
  const hideOut = plan.inStockOnly || projection.search.hideOutOfStockByDefault;
  const { items, total } = await search(
    { q: plan.query, category: plan.category || undefined, minPrice: plan.minPrice > 0 ? plan.minPrice : undefined, maxPrice: plan.maxPrice > 0 ? plan.maxPrice : undefined, inStockOnly: hideOut },
    1,
    plan.layout === "single" ? 1 : plan.layout === "compare" ? 4 : 12,
  );
  const ready = stripeReady();
  const decided: Item[] = items.map((p) => ({ ...p, buy: buyDecision(p, projection, ready) }));
  mark("execute", t, `catalog kernel: ${total} matches${hideOut ? ", in stock only" : ""} · buy rule on ${decided.length}`);

  const known = new Map([...part.policies.map((p) => [p.key, p.statement] as const), ...part.rulings.flatMap((r) => r.keys.map((k) => [k, r.ruling] as const))]);
  const rules = [...new Set([...plan.rulesApplied, ...(decided.length ? projection.buy.policies : [])])].filter((k) => known.has(k)).map((key) => ({ key, text: known.get(key)! }));
  stages.push({ name: "render", ms: 0, detail: `${plan.layout} layout from tested components` });

  const trace: Trace = {
    id: randomUUID().slice(0, 8), at: new Date().toISOString(), request, bookVersion: book?.version ?? null, compiled, stages, model: call.model,
    tokensIn: call.tokensIn, tokensOut: call.tokensOut, costUsd: call.costUsd, totalMs: Date.now() - t0, rules,
  };
  console.log(`[cradle] ${JSON.stringify({ id: trace.id, request, plan: { intent: plan.intent, query: plan.query, category: plan.category }, total, ms: trace.totalMs, cost: trace.costUsd, rules: rules.map((r) => r.key), book: trace.bookVersion })}`);
  return { plan, items: decided, total, trace, projection };
}
