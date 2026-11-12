import { describe, expect, it } from "vitest";

import type { Item, Plan } from "./agent";
import { initial, reduce } from "./live";
import { buildSpec, specData, specText, validateSpec, type Spec, type View } from "./ui";

const item = (id: string, price: number, ok = true): Item => ({
  id, name: `Drill ${id}`, image: null, blurb: "", brand: "Acme", price, currency: "USD", inStock: true, stock: "in",
  category: "Tools", rating: 4.5, reviews: 10, buy: ok ? { ok, reason: "", policies: [] } : { ok, reason: "Out of stock.", policies: ["P-1"] },
});

const PLAN: Plan = {
  intent: "find", layout: "grid", query: "cordless drill", category: "Tools", minPrice: 0, maxPrice: 150, inStockOnly: true, sort: "relevance", count: 0,
  headline: "Cordless drills under $150", explanation: "In stock only, by the store's rules.", followUp: "drill bits", rulesApplied: [], alternatives: [],
};

const types = (s: Spec) => s.elements[s.root]!.children.map((id) => s.elements[id]!.type);

describe("buildSpec", () => {
  it("starts as a heading and a skeleton, before the model has written anything", () => {
    const s = buildSpec({ request: "a drill", plan: {}, done: false });
    expect(types(s)).toEqual(["Heading", "Skeleton"]);
    expect(validateSpec(s, specData(undefined))).toEqual([]);
  });

  it("patches in place: the skeleton takes the chosen layout, then the products replace it", () => {
    const partial = buildSpec({ request: "compare drills", plan: { layout: "compare", headline: "Compar" }, done: false });
    expect(partial.elements.body).toMatchObject({ type: "Skeleton", props: { layout: "compare" } });
    expect(partial.elements.heading!.props).toMatchObject({ headline: "Compar" });

    const items = [item("a", 99), item("b", 120)];
    const done = buildSpec({ request: "compare drills", plan: { ...PLAN, layout: "compare" }, items, total: 2, done: true });
    expect(done.elements.body).toEqual({ type: "Compare", props: { ids: ["a", "b"] }, children: [] });
    expect(types(done)).toEqual(["Heading", "Filters", "Compare", "FollowUp"]);
    expect(validateSpec(done, specData(items))).toEqual([]);
  });

  it("shows the search the kernel actually ran, and the empty state only when the answer is final", () => {
    const v: View = { request: "x", plan: PLAN, items: [], total: 0, searched: { query: "drill", category: "" }, done: false };
    expect(buildSpec(v).elements.body!.type).toBe("Skeleton"); // still trying the alternatives
    const done = buildSpec({ ...v, done: true });
    expect(done.elements.body!.type).toBe("Empty");
    expect(done.elements.filters!.props).toMatchObject({ chips: ["“drill”", "up to $150.00", "in stock"], total: 0 });
  });
});

describe("saying plainly what the store did", () => {
  it("names the substitution when the shopper's keywords found nothing", () => {
    const items = [item("h", 30)];
    const s = buildSpec({ request: "x", plan: PLAN, items, total: 1, searched: { query: "wet dry vacuum", category: "", broadenedFrom: "shop vac" }, done: true });
    expect(s.elements.filters!.props).toMatchObject({ note: "No exact match for “shop vac”, so these are the closest the catalog has, for “wet dry vacuum”." });
    expect(validateSpec(s, specData(items))).toEqual([]);
  });

  it("shows one product as a single card, not a one-column comparison", () => {
    const items = [item("h", 30)];
    const s = buildSpec({ request: "x", plan: { ...PLAN, layout: "compare" }, items, total: 1, done: true });
    expect(s.elements.body).toMatchObject({ type: "Products", props: { layout: "single", ids: ["h"] } });
    expect((s.elements.filters!.props as { note?: string }).note).toBe("Only one product matched, so there is nothing to compare it with.");
  });

  it("drops a follow-up that talks to the shopper instead of being a request they can send", () => {
    const ask = (followUp: string) => buildSpec({ request: "x", plan: { ...PLAN, followUp }, items: [item("a", 1)], total: 1, done: true }).elements.followUp;
    expect(ask("Would you like a push mower or a riding mower?")).toBeUndefined();
    expect(ask("What is your budget?")).toBeUndefined();
    expect(ask("battery push mowers under $300")).toMatchObject({ props: { text: "battery push mowers under $300" } });
  });
});

describe("validateSpec", () => {
  const items = [item("a", 99)];
  const good = buildSpec({ request: "x", plan: PLAN, items, total: 1, done: true });

  it("refuses components outside the catalog, unknown or wrong props, and a price in the spec", () => {
    const bad = structuredClone(good) as Spec;
    (bad.elements.heading as { type: string }).type = "Banner";
    (bad.elements.body!.props as Record<string, unknown>).price = 1;
    (bad.elements.filters!.props as Record<string, unknown>).chips = "x";
    expect(validateSpec(bad, specData(items))).toEqual([
      '"heading" is "Banner", not a catalog component',
      'Filters "filters": "chips" is not string[]',
      'Products "body": unknown prop "price"',
    ]);
  });

  it("refuses products the kernel didn't return, missing children, cycles and orphans", () => {
    const bad = structuredClone(good) as Spec;
    (bad.elements.body!.props as { ids: string[] }).ids = ["a", "zzz"];
    bad.elements.answer!.children.push("ghost");
    bad.elements.orphan = { type: "Empty", props: { message: "" }, children: [] };
    bad.elements.followUp!.children = ["answer"];
    expect(validateSpec(bad, specData(items))).toEqual([
      'Products "body": product zzz is not in the kernel\'s results',
      'cycle at "answer"',
      '"answer" names a missing child "ghost"',
      '"orphan" is not reachable from the root',
    ]);
  });
});

describe("specText", () => {
  it("renders the same answer for chat and voice, with prices and buy decisions from the kernel", () => {
    const items = [item("a", 99), item("b", 120, false)];
    const spec = buildSpec({ request: "x", plan: PLAN, items, total: 2, done: true });
    expect(specText(spec, specData(items))).toBe(
      [
        "Cordless drills under $150",
        "In stock only, by the store's rules.",
        "2 matches.",
        "1. Drill a: $99.00, you can buy it now.",
        "2. Drill b: $120.00, out of stock.",
        "You could also ask: drill bits",
      ].join("\n"),
    );
  });
});

describe("the browser's reducer", () => {
  it("marks when each part reached the screen, and keeps the products when the final plan arrives", () => {
    let s = initial("drill");
    s = reduce(s, { type: "plan", at: 300, plan: { intent: "find" } }, 320);
    s = reduce(s, { type: "plan", at: 350, plan: { intent: "find", layout: "grid" } }, 380);
    s = reduce(s, { type: "items", at: 600, items: [item("a", 99)], total: 1, searched: { query: "drill", category: "" }, hideOutOfStock: true }, 640);
    s = reduce(s, { type: "done", at: 900, plan: PLAN, total: 1, trace: {} as never }, 950);
    expect(s.marks).toEqual({ plan: 320, layout: 380, products: 640, done: 950 });
    expect(s.view.items?.map((p) => p.id)).toEqual(["a"]);
    expect(s.view.done).toBe(true);
    expect(s.view.plan).toBe(PLAN);
  });

  it("records an error without losing what was already shown", () => {
    const s = reduce(reduce(initial("x"), { type: "plan", at: 1, plan: { layout: "grid" } }, 5), { type: "error", at: 9, message: "nope" }, 10);
    expect(s.error).toBe("nope");
    expect(s.view.plan.layout).toBe("grid");
  });
});
