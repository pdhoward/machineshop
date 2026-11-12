import type { Item, Plan, Searched } from "./agent";
import { money } from "../product";

/**
 * The component catalog and the answer spec (gen3-cradle.md §1.5, B8).
 *
 * The app agent's answer is a spec: a flat tree of elements, each a component
 * from this catalog with checked props (the same shape as Vercel's
 * json-render, `{ root, elements: { id: { type, props, children } } }`, so we
 * can adopt its renderers later). The spec is assembled by code from the
 * model's narrow choices (intent, layout, keywords) and the kernel's results,
 * never written by the model, so it is valid by construction and the gate
 * checks it anyway.
 *
 * Kernel-bound components take product ids, not prices: every renderer reads
 * price, stock and the buy decision from the kernel's data, so no surface can
 * disagree with the catalog or the rules. Free text (headline, explanation,
 * follow-up) is Routine content the model may word.
 *
 * Renderers: the web store (components/cradle/spec-view.tsx) and plain text
 * for chat and voice (specText below). Each must handle every component; the
 * types make a missing one a compile error.
 */

type PropType = "string" | "number" | "boolean" | "string[]" | readonly string[];
type PropSpec = { type: PropType; optional?: boolean };

const LAYOUTS = ["grid", "single", "compare"] as const;
export type Layout = (typeof LAYOUTS)[number];

export const CATALOG = {
  Answer: { description: "The answer to one shopper request: its parts, in order.", bound: false, expresses: [], props: {} },
  Heading: {
    description: "What the shopper asked, the headline and a short explanation of what the store did and why.",
    bound: false,
    expresses: [],
    props: { request: { type: "string" }, headline: { type: "string", optional: true }, explanation: { type: "string", optional: true } },
  },
  Filters: {
    description: "The search the store ran: keyword, department, price range, stock, and the number of matches.",
    bound: false,
    expresses: ["product", "price", "inventory"],
    props: {
      chips: { type: "string[]" },
      total: { type: "number", optional: true },
      /** How many of the total are shown, when fewer. */
      shown: { type: "number", optional: true },
      more: { type: "boolean", optional: true },
      classicHref: { type: "string", optional: true },
      /** Said plainly when the store substituted: other keywords, or one product where a comparison was asked for. */
      note: { type: "string", optional: true },
    },
  },
  Products: {
    description: "Products as cards with their buy decision. Prices and stock come from the catalog kernel.",
    bound: true,
    expresses: ["product", "price", "inventory", "checkout"],
    props: { layout: { type: ["grid", "single"] }, ids: { type: "string[]" } },
  },
  Compare: {
    description: "Products side by side: price, brand, rating, stock and the buy decision, from the kernel.",
    bound: true,
    expresses: ["product", "price", "inventory", "checkout"],
    props: { ids: { type: "string[]" } },
  },
  Skeleton: { description: "The layout's shape while results load.", bound: false, expresses: [], props: { layout: { type: LAYOUTS }, count: { type: "number" } } },
  Empty: { description: "Nothing matched under the store's rules.", bound: false, expresses: [], props: { message: { type: "string" } } },
  FollowUp: { description: "One suggestion of what to ask next.", bound: false, expresses: [], props: { text: { type: "string" } } },
} as const satisfies Record<string, { description: string; bound: boolean; expresses: readonly string[]; props: Record<string, PropSpec> }>;

export type ComponentType = keyof typeof CATALOG;

/** Each component's props, as the renderers receive them. */
export type PropsOf = {
  Answer: Record<string, never>;
  Heading: { request: string; headline?: string; explanation?: string };
  Filters: { chips: string[]; total?: number; shown?: number; more?: boolean; classicHref?: string; note?: string };
  Products: { layout: "grid" | "single"; ids: string[] };
  Compare: { ids: string[] };
  Skeleton: { layout: Layout; count: number };
  Empty: { message: string };
  FollowUp: { text: string };
};

export type Element<K extends ComponentType = ComponentType> = { type: K; props: PropsOf[K]; children: string[] };
export type Spec = { root: string; elements: Record<string, Element> };
/** What kernel-bound components read: the products by id, with the kernel's buy decision. */
export type SpecData = { products: Record<string, Item> };

/** What the screen knows so far about one request: the model's choices (maybe partial) and the kernel's results (once in). */
export type View = {
  request: string;
  plan: Partial<Plan>;
  /** Undefined while the search is running. */
  items?: Item[];
  total?: number;
  /** The keywords and department the kernel actually searched (after any broadening). */
  searched?: Searched;
  hideOutOfStock?: boolean;
  /** The answer is final: no more fields or results are coming. */
  done: boolean;
};

const el = <K extends ComponentType>(type: K, props: PropsOf[K], children: string[] = []): Element => ({ type, props, children }) as Element;

/** The answer's spec, built by code from what is known so far: a skeleton first, patched in place as fields and results arrive. */
export function buildSpec(v: View): Spec {
  const { plan } = v;
  const layout: Layout = plan.layout ?? "grid";
  const elements: Record<string, Element> = {};
  const children: string[] = [];
  const add = (id: string, e: Element) => ((elements[id] = e), children.push(id));

  add("heading", el("Heading", { request: v.request, ...(plan.headline != null && { headline: plan.headline }), ...(plan.explanation != null && { explanation: plan.explanation }) }));

  const query = v.searched?.query ?? plan.query;
  if (query) {
    const category = v.searched ? v.searched.category : (plan.category ?? "");
    const chips = [
      `“${query}”`,
      category,
      (plan.minPrice ?? 0) > 0 && `from ${money(plan.minPrice!)}`,
      (plan.maxPrice ?? 0) > 0 && `up to ${money(plan.maxPrice!)}`,
      (plan.inStockOnly || v.hideOutOfStock) && "in stock",
    ].filter((c): c is string => !!c);
    const classic = new URLSearchParams({ q: query, ...(category ? { c: category } : {}), classic: "1" });
    const lone = layout === "compare" && v.items?.length === 1;
    const notes = [
      v.searched?.broadenedFrom && v.items?.length && `No exact match for “${v.searched.broadenedFrom}”, so these are the closest the catalog has, for “${query}”.`,
      lone && "Only one product matched, so there is nothing to compare it with.",
    ].filter((n): n is string => !!n);
    add(
      "filters",
      el("Filters", {
        chips,
        ...(v.total != null && { total: v.total }),
        ...(v.items && v.total != null && { more: v.total > v.items.length }),
        ...(v.items?.length && v.total != null && v.total > v.items.length && { shown: v.items.length }),
        classicHref: `/?${classic}`,
        ...(notes.length && { note: notes.join(" ") }),
      }),
    );
  }

  if (!v.items || (!v.items.length && !v.done)) {
    add("body", el("Skeleton", { layout, count: layout === "single" ? 1 : layout === "compare" ? 3 : 8 }));
  } else if (!v.items.length) {
    add("body", el("Empty", { message: "Nothing in the catalog matches that under the store's rules. Try different words." }));
  } else if (layout === "compare" && v.items.length > 1) {
    add("body", el("Compare", { ids: v.items.map((p) => p.id) }));
  } else {
    add("body", el("Products", { layout: layout === "compare" ? "single" : layout, ids: v.items.map((p) => p.id) }));
  }

  // A follow-up is a request the shopper can send as is; one that talks to the shopper ("Would you like…") is dropped.
  if (v.done && plan.followUp && !/\byou(r|'d|'re)?\b/i.test(plan.followUp)) add("followUp", el("FollowUp", { text: plan.followUp }));

  elements.answer = el("Answer", {}, children);
  return { root: "answer", elements };
}

export const specData = (items: Item[] | undefined): SpecData => ({ products: Object.fromEntries((items ?? []).map((p) => [p.id, p])) });

/** Problems with a spec, against the catalog and the kernel's data: unknown components, bad props, unbound products, broken tree. Empty when valid. */
export function validateSpec(spec: Spec, data: SpecData): string[] {
  const problems: string[] = [];
  if (!spec.elements[spec.root]) return [`root "${spec.root}" is not an element`];
  const seen = new Set<string>();
  const walk = (id: string, path: string[]) => {
    if (path.includes(id)) return void problems.push(`cycle at "${id}"`);
    if (seen.has(id)) return void problems.push(`"${id}" appears twice`);
    seen.add(id);
    const e = spec.elements[id];
    if (!e) return void problems.push(`"${path.at(-1)}" names a missing child "${id}"`);
    const def = CATALOG[e.type as ComponentType];
    if (!def) return void problems.push(`"${id}" is "${e.type}", not a catalog component`);
    const props = (e.props ?? {}) as Record<string, unknown>;
    const allowed = def.props as Record<string, PropSpec>;
    for (const k of Object.keys(props)) if (!allowed[k]) problems.push(`${e.type} "${id}": unknown prop "${k}"`);
    for (const [k, p] of Object.entries(allowed)) {
      const v = props[k];
      if (v === undefined) {
        if (!p.optional) problems.push(`${e.type} "${id}": missing "${k}"`);
      } else if (!fits(v, p.type)) problems.push(`${e.type} "${id}": "${k}" is not ${typeof p.type === "string" ? p.type : p.type.join(" | ")}`);
    }
    if (def.bound) for (const pid of (props.ids as string[] | undefined) ?? []) if (!data.products[pid]) problems.push(`${e.type} "${id}": product ${pid} is not in the kernel's results`);
    for (const c of e.children ?? []) walk(c, [...path, id]);
  };
  walk(spec.root, []);
  for (const id of Object.keys(spec.elements)) if (!seen.has(id)) problems.push(`"${id}" is not reachable from the root`);
  return problems;
}

function fits(v: unknown, t: PropType): boolean {
  if (typeof t !== "string") return typeof v === "string" && t.includes(v);
  if (t === "string[]") return Array.isArray(v) && v.every((x) => typeof x === "string");
  return typeof v === t;
}

/** The same answer as plain text, for chat and voice: prices and buy decisions read from the kernel's data, never from the spec. */
export function specText(spec: Spec, data: SpecData): string {
  const lines: string[] = [];
  const product = (p: Item, n: number) =>
    `${n}. ${p.name}: ${p.price != null ? money(p.price, p.currency) : "price not listed"}, ${p.buy.ok ? "you can buy it now" : p.buy.reason.replace(/\.$/, "").toLowerCase()}.`;
  const render: { [K in ComponentType]: (props: PropsOf[K], children: string[]) => void } = {
    Answer: (_p, children) => children.forEach(visit),
    Heading: (p) => {
      if (p.headline) lines.push(p.headline);
      if (p.explanation) lines.push(p.explanation);
    },
    Filters: (p) => {
      if (p.note) lines.push(p.note);
      if (p.total != null) lines.push(`${p.shown != null ? `${p.shown} of ` : ""}${p.total.toLocaleString("en-US")} ${p.total === 1 ? "match" : "matches"}.`);
    },
    Products: (p) => p.ids.forEach((id, i) => data.products[id] && lines.push(product(data.products[id], i + 1))),
    Compare: (p) => p.ids.forEach((id, i) => data.products[id] && lines.push(product(data.products[id], i + 1))),
    Skeleton: () => lines.push("Looking…"),
    Empty: (p) => lines.push(p.message),
    FollowUp: (p) => lines.push(`You could also ask: ${p.text}`),
  };
  function visit(id: string) {
    const e = spec.elements[id];
    if (e) (render[e.type] as (p: unknown, c: string[]) => void)(e.props, e.children);
  }
  visit(spec.root);
  return lines.join("\n");
}
