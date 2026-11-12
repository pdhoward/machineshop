import "server-only";

import { randomUUID } from "node:crypto";

import { listDepartments, search } from "../catalog";
import { stripeReady } from "../stripe";
import type { ProductCard } from "../product";
import { bookText, ground } from "./book";
import { compiledRules, type Rules } from "./compile";
import { FAST_MODEL, jsonStream } from "./model";
import { scanObject } from "./partial-json";
import { productSelector } from "./kernels";
import { groundingFor, introduce } from "./site";
import { buyDecision, type BuyDecision, type Projection } from "./projection";
import { buildSpec, type Spec } from "./ui";

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
  /** The order the shopper asked for ("the cheapest", "best rated"); relevance otherwise. */
  sort: "relevance" | "price_low" | "price_high" | "rating";
  /** How many products the shopper asked for ("two", "a few"); 0 when they didn't say. */
  count: number;
  headline: string;
  explanation: string;
  rulesApplied: string[];
  followUp: string;
  /** Broader keyword sets to try, in order, when the first search finds nothing. */
  alternatives: string[];
};

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  // The choices the search needs come first and the words after, so the search can start while the model is still writing (B21).
  required: ["intent", "layout", "query", "category", "minPrice", "maxPrice", "inStockOnly", "sort", "count", "alternatives", "headline", "explanation", "followUp", "rulesApplied"],
  properties: {
    intent: { type: "string", enum: ["find", "compare", "one_product", "buy", "other"] },
    layout: { type: "string", enum: ["grid", "compare", "single"] },
    query: { type: "string" },
    category: { type: "string" },
    minPrice: { type: "number" },
    maxPrice: { type: "number" },
    inStockOnly: { type: "boolean" },
    sort: { type: "string", enum: ["relevance", "price_low", "price_high", "rating"] },
    count: { type: "integer" },
    alternatives: { type: "array", items: { type: "string" } },
    headline: { type: "string" },
    explanation: { type: "string" },
    followUp: { type: "string" },
    rulesApplied: { type: "array", items: { type: "string" } },
  },
};


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
  /** The decide call's cost; a compile this request waited for is reported apart (it serves every later request). */
  costUsd: number;
  totalMs: number;
  rules: { key: string; text: string }[];
  /** This request compiled the rules first (the first request on a new version or a fresh server instance). */
  compile: { model: string; ms: number; costUsd: number } | null;
  /** When things happened, in ms from the start of the request (B21): measured, not claimed. Null when it didn't happen. */
  timeline: { firstField: number | null; searchStarted: number | null; products: number | null; decided: number };
};
export type Item = ProductCard & { buy: BuyDecision };
export type Answer = { plan: Plan; items: Item[]; total: number; trace: Trace; projection: Projection; spec: Spec };

/** What the screen is told as the answer forms (B21), each stamped with ms since the request started. */
export type AnswerEvent =
  | { type: "plan"; at: number; plan: Partial<Plan> }
  | { type: "items"; at: number; items: Item[]; total: number; searched: Searched; hideOutOfStock: boolean }
  | { type: "done"; at: number; plan: Plan; total: number; trace: Trace }
  | { type: "error"; at: number; message: string };

/** The fields the catalog search needs: once the model has written these, the search starts. */
/** How many candidates the kernel returns for ranking. */
const POOL = 40;
const SEARCH_FIELDS = ["layout", "query", "category", "minPrice", "maxPrice", "inStockOnly", "sort", "count", "alternatives"] as const;
type Search = Pick<Plan, (typeof SEARCH_FIELDS)[number]>;
type Found = { items: ProductCard[]; total: number; used: { q: string; category?: string }; broadened: boolean; from: string };
/** What the kernel searched; `broadenedFrom` names the shopper's keywords when they found nothing and others were used. */
export type Searched = { query: string; category: string; broadenedFrom?: string };
const searchedOf = (f: Found): Searched => ({ query: f.used.q, category: f.used.category ?? "", ...(f.used.q !== f.from && { broadenedFrom: f.from }) });

// Who the site is comes from its registration, and which rules apply from its industry pack (both in the book): nothing here names a site.
const SYSTEM = (site: string, departments: string) => `You are the app agent of ${site}. A shopper typed a request into the store's search box. Decide what to look for in the catalog and how to present it, following the store's rules below.

Return:
- query: 1 to 4 short catalog keywords (nouns a product name or category would contain, e.g. "cordless drill"). Never put prices, adjectives like "cheap", or stock words in query.
- category: one department from this list when the request clearly belongs to it, else "": ${departments}
- minPrice / maxPrice: dollars, 0 when not stated.
- inStockOnly: true when the shopper asks for things available now, or when the rules say out-of-stock products must not be offered.
- layout: "compare" when the shopper wants to compare or choose between options, "single" when they name one specific product, else "grid".
- sort: "price_low" when the shopper wants the cheapest or least expensive, "price_high" for the most expensive or premium, "rating" for the best rated, else "relevance".
- count: how many products the shopper asked for ("two" is 2, "a couple" is 2, "a few" is 3), else 0.
- headline: a short title for the results. explanation: one or two sentences telling the shopper what you looked for and which store rules shaped the results, in plain words (no policy keys).
- rulesApplied: the keys of the policies or rulings that shaped this decision (only keys that appear below).
- followUp: one short request the shopper could send next, written exactly as the shopper would type it into the search box, complete on its own (e.g. "battery push mowers under $300"). Never a question to the shopper, never "you".
- alternatives: 2 or 3 broader or different keyword sets (1 or 2 words each) for the same need, used if the first search finds nothing. For "keep my garage floor clean": ["floor cleaner", "broom", "floor mat"].`;

/**
 * Carry out one request. `candidate` lets the conformance gate run it on a
 * candidate book instead of the one in force; `emit` streams the answer to
 * the screen as it forms (the gate and the text channel just await the end).
 */
export async function ask(request: string, candidate?: Rules, emit?: (e: AnswerEvent) => void): Promise<Answer> {
  const t0 = Date.now();
  const since = () => Date.now() - t0;
  const stages: Stage[] = [];
  const mark = (name: Stage["name"], from: number, detail: string) => stages.push({ name, ms: Date.now() - from, detail });

  // Route: a search request; ground on the concepts the site's industry pack names for search.
  let t = Date.now();
  // Timed apart, so the Why drawer shows where the wait is: the rules (from the Accelerator, compiled) or the departments (the catalog).
  const from = t;
  let rulesMs = 0;
  let departmentsMs = 0;
  const [{ book, projection, compiled, compiledNow, call: compileCall, source }, departments] = await Promise.all([
    (candidate ? Promise.resolve({ ...candidate, compiled: true, compiledNow: false, call: null, source: "compiled" as const }) : compiledRules()).then((r) => ((rulesMs = Date.now() - from), r)),
    listDepartments()
      .catch(() => [])
      .then((d) => ((departmentsMs = Date.now() - from), d)),
  ]);
  const compile = compiledNow && compileCall ? { model: compileCall.model, ms: compileCall.ms, costUsd: compileCall.costUsd } : null;
  mark(
    "route",
    t,
    `search request · grounding: ${book ? groundingFor(book, "search").join(", ") : "none"}${book?.pack?.grounding?.search ? " (from the pack)" : ""} · rules ${rulesMs} ms${compile ? ` (compiled them first: ${compile.model}, ${(compile.ms / 1000).toFixed(1)} s, $${compile.costUsd.toFixed(4)})` : source === "stored" ? " (settings compiled once and kept on the Accelerator)" : ""} · departments ${departmentsMs} ms`,
  );

  t = Date.now();
  const concepts = book ? groundingFor(book, "search") : [];
  const part = book ? ground(book, concepts) : { policies: [], rulings: [] };
  mark("ground", t, book ? `${part.policies.length} of ${book.policies.length} policies and ${part.rulings.length} rulings, book ${book.version}` : "no book: safe settings");

  // The exact half of search (which candidates are the product, in what order) is the site's pack kernel; the model only read the words.
  const selector = productSelector(book);
  const hideOut = (inStockOnly: boolean | undefined) => !!inStockOnly || projection.search.hideOutOfStockByDefault;
  const sizeOf = (layout: Plan["layout"]) => (layout === "single" ? 1 : layout === "compare" ? 4 : 12);
  // The shopper's own number when they gave one ("compare two"), within the layout's room.
  const countOf = (f: Search) => (f.count > 0 ? Math.min(f.count, sizeOf(f.layout) === 1 ? 1 : 12) : sizeOf(f.layout));
  const ready = stripeReady();
  const decide = (items: ProductCard[]): Item[] => items.map((p) => ({ ...p, buy: buyDecision(p, projection, ready) }));
  const priceOf = (f: Search) => ({ minPrice: f.minPrice > 0 ? f.minPrice : undefined, maxPrice: f.maxPrice > 0 ? f.maxPrice : undefined, inStockOnly: hideOut(f.inStockOnly) });

  // The kernel needs every keyword to match, so a miss is common. Every attempt runs at once (the keywords in the department,
  // without it, then the agent's broader alternatives) and the first hit in that order wins: a miss costs no extra wait.
  // A comparison needs two products: the first attempt with two wins, else the first with any.
  const findAll = async (f: Search): Promise<Found> => {
    const attempts: { q: string; category?: string }[] = [
      { q: f.query, category: f.category || undefined },
      ...(f.category ? [{ q: f.query }] : []),
      ...(f.alternatives ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 3).map((q) => ({ q })),
    ];
    // The kernel returns candidates where every word appears; the platform ranks a pool of them so the
    // products themselves come before the parts that mention them (B9), then keeps the layout's size.
    // An asked-for order goes to the kernel too, so the pool holds the cheapest (or best rated) candidates, not just the first ones.
    const sort = f.sort === "price_low" ? "price_asc" : f.sort === "price_high" ? "price_desc" : f.sort === "rating" ? "rating" : undefined;
    const runs = attempts.map((a) =>
      search({ q: a.q, category: a.category, ...priceOf(f), sort }, 1, POOL).then((r) => ({
        total: r.total,
        items: selector.select(r.items, a.q, (p) => ({ title: p.name, trail: p.trail, price: p.price, rating: p.rating }), f.sort ?? "relevance", countOf(f)),
      })),
    );
    runs.forEach((r) => r.catch(() => {})); // those after a hit are never awaited
    const need = f.layout === "compare" ? 2 : 1;
    let best: Found | null = null;
    for (const [i, run] of runs.entries()) {
      const r = await run;
      const found = { ...r, used: attempts[i]!, broadened: i > 0, from: f.query };
      if (r.items.length >= need) return found;
      if (r.items.length && !best) best = found;
    }
    return best ?? { items: [], total: 0, used: attempts[0]!, broadened: false, from: f.query };
  };

  let firstField: number | null = null;
  let searchStarted: number | null = null;
  let products: number | null = null;
  let early: Promise<Found> | null = null;
  let shown = false;
  const show = (f: Found, inStockOnly: boolean) => {
    products ??= since();
    shown = true;
    emit?.({ type: "items", at: since(), items: decide(f.items), total: f.total, searched: searchedOf(f), hideOutOfStock: hideOut(inStockOnly) });
  };

  // Decide: one streamed call. The search starts as soon as its fields are written; the screen sees each field as it forms.
  t = Date.now();
  let lastSent = 0;
  let lastComplete = 0;
  const call = await jsonStream<Plan>({
    role: "search", model: FAST_MODEL(), effort: "low", think: false, maxTokens: 1200, schema: PLAN_SCHEMA,
    system: `${SYSTEM(introduce(book), departments.map((d) => d.name).join(", "))}\n\nThe store's rules in force:\n${bookText(part) || "(none available: be cautious)"}`,
    user: request.slice(0, 500),
    onText: (soFar) => {
      const scan = scanObject(soFar);
      if (scan.complete.size && firstField == null) firstField = since();
      if (!early && SEARCH_FIELDS.every((k) => scan.complete.has(k))) {
        searchStarted = since();
        const f = scan.values as Search;
        early = findAll(f);
        // Shown the moment it lands; a failure surfaces where it is awaited below.
        early.then((found) => found.items.length && show(found, f.inStockOnly)).catch(() => {});
      }
      if (!emit) return;
      // Patch the screen at once when a field finishes, else at most every 40 ms while a string grows.
      const now = Date.now();
      if (scan.complete.size === lastComplete && now - lastSent < 40) return;
      lastSent = now;
      lastComplete = scan.complete.size;
      emit({ type: "plan", at: since(), plan: { ...scan.values, ...(scan.open && { [scan.open.key]: scan.open.value }) } as Partial<Plan> });
    },
  });
  const plan = call.data;
  const decided = since();
  mark("decide", t, `${call.model} · intent ${plan.intent} · "${plan.query}"${plan.category ? ` in ${plan.category}` : ""}${call.firstTextMs != null ? ` · first text after ${call.firstTextMs} ms` : ""} · ${call.tokensIn.toLocaleString("en-US")} tokens in (${(call.cachedIn ?? 0).toLocaleString("en-US")} cached), ${call.tokensOut} out`);

  t = Date.now();
  const found = await (early ?? ((searchStarted = since()), findAll(plan)));
  // The early search showed its hits the moment they landed (its .then ran before this await resumed); a miss is shown now.
  if (!shown) show(found, plan.inStockOnly);
  const { total, used } = found;
  if (used.q !== plan.query || (used.category ?? "") !== plan.category) {
    plan.query = used.q;
    plan.category = used.category ?? "";
  }
  const items = decide(found.items);
  const overlap = searchStarted != null && searchStarted < decided ? ` · started at ${searchStarted} ms, ${decided - searchStarted} ms before the model finished` : "";
  mark(
    "execute",
    t,
    `catalog kernel: ${total} matches for "${used.q}"${used.category ? ` in ${used.category}` : ""}${hideOut(plan.inStockOnly) ? ", in stock only" : ""}${found.broadened ? " (broadened after a miss)" : ""} · ${selector.kernel ? `kernel ${selector.kernel} (${book?.pack?.label ?? book?.pack?.id} pack)` : "no pack kernel: catalog order"} · buy rule on ${items.length}${overlap}`,
  );

  const known = new Map([...part.policies.map((p) => [p.key, p.statement] as const), ...part.rulings.flatMap((r) => r.keys.map((k) => [k, r.ruling] as const))]);
  const rules = [...new Set([...plan.rulesApplied, ...(items.length ? projection.buy.policies : [])])].filter((k) => known.has(k)).map((key) => ({ key, text: known.get(key)! }));
  const spec = buildSpec({ request, plan, items, total, searched: searchedOf(found), hideOutOfStock: hideOut(plan.inStockOnly), done: true });
  const parts = Object.values(spec.elements).map((e) => e.type).filter((x) => x !== "Answer");
  stages.push({ name: "render", ms: 0, detail: `${plan.layout} layout from ${parts.length} catalog components: ${parts.join(", ")}` });

  const trace: Trace = {
    id: randomUUID().slice(0, 8), at: new Date().toISOString(), request, bookVersion: book?.version ?? null, compiled, stages, model: call.model,
    tokensIn: call.tokensIn, tokensOut: call.tokensOut, costUsd: call.costUsd, totalMs: since(), rules, compile,
    timeline: { firstField, searchStarted, products, decided },
  };
  emit?.({ type: "done", at: since(), plan, total, trace });
  console.log(`[cradle] ${JSON.stringify({ id: trace.id, request, plan: { intent: plan.intent, query: plan.query, category: plan.category }, total, ms: trace.totalMs, timeline: trace.timeline, cost: trace.costUsd, rules: rules.map((r) => r.key), book: trace.bookVersion })}`);
  return { plan, items, total, trace, projection, spec };
}
