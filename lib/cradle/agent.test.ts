import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductCard } from "../product";
import type { AnswerEvent, Plan } from "./agent";
import { SAFE_PROJECTION } from "./projection";
import { validateSpec, specData } from "./ui";

/**
 * Fast UI (B21): the catalog search starts as soon as the model has written
 * the fields it needs, while it is still writing the headline, and the screen
 * hears about every step. The model and the catalog are mocked.
 */

const mocks = vi.hoisted(() => ({ search: vi.fn(), jsonStream: vi.fn() }));
vi.mock("../catalog", () => ({ search: mocks.search, listDepartments: async () => [{ name: "Tools", count: 10 }] }));
vi.mock("../stripe", () => ({ stripeReady: () => true }));
vi.mock("./compile", () => ({ compiledRules: async () => ({ book: null, projection: SAFE_PROJECTION, compiled: false, compiledNow: false, call: null }) }));
vi.mock("./model", () => ({ FAST_MODEL: () => "claude-haiku-5-5", jsonStream: mocks.jsonStream }));

const card = (id: string): ProductCard => ({ id, name: id, image: null, blurb: "", brand: null, price: 50, currency: "USD", inStock: true, stock: "in", category: "Tools", rating: null, reviews: null });

const PLAN: Plan = {
  intent: "find", layout: "grid", query: "drill", category: "Tools", minPrice: 0, maxPrice: 100, inStockOnly: true,
  headline: "Drills under $100", explanation: "Only what you can buy today.", followUp: "drill bits", rulesApplied: [], alternatives: ["driver"],
};

/** A model that writes the plan in small chunks, yielding between them, and records what had happened when it finished. */
function streamingModel(plan: Plan, log: string[]) {
  mocks.jsonStream.mockImplementation(async (opts: { onText: (s: string) => void }) => {
    const text = JSON.stringify(plan);
    for (let n = 8; n < text.length + 8; n += 8) {
      opts.onText(text.slice(0, n));
      await new Promise((r) => setTimeout(r, 1));
    }
    log.push("model finished");
    return { data: structuredClone(plan), model: "claude-haiku-5-5", ms: 5, tokensIn: 100, tokensOut: 60, costUsd: 0.0001 };
  });
}

describe("ask, streamed", () => {
  beforeEach(() => {
    mocks.search.mockReset();
    mocks.jsonStream.mockReset();
  });

  it("starts the search before the model finishes and shows products before the answer is done", async () => {
    const log: string[] = [];
    streamingModel(PLAN, log);
    mocks.search.mockImplementation(async (q: { q: string; category?: string }) => {
      log.push(`search ${q.q} in ${q.category ?? "all"}`);
      return { items: [card("a"), card("b")], total: 2 };
    });
    const { ask } = await import("./agent");
    const events: AnswerEvent[] = [];
    const a = await ask("a drill under 100 I can buy today", undefined, (e) => {
      events.push(e);
      if (e.type === "items") log.push("products shown");
    });

    // Every attempt runs at once (so a miss costs no wait); the first in priority order that hits wins,
    // and the products reach the screen before the model has finished writing.
    expect(log).toEqual(["search drill in Tools", "search drill in all", "search driver in all", "products shown", "model finished"]);
    expect(a.plan.query).toBe("drill");
    expect(a.plan.category).toBe("Tools");
    expect(mocks.search).toHaveBeenCalledWith({ q: "drill", category: "Tools", minPrice: undefined, maxPrice: 100, inStockOnly: true }, 1, 12);

    const kinds = events.map((e) => e.type);
    expect(kinds.at(-1)).toBe("done");
    expect(kinds.filter((k) => k === "items")).toHaveLength(1);
    // The headline is shown as it is written.
    const headlines = events.flatMap((e) => (e.type === "plan" && e.plan.headline ? [e.plan.headline] : []));
    expect(headlines.length).toBeGreaterThan(1);
    expect(PLAN.headline.startsWith(headlines[0]!)).toBe(true);

    const t = a.trace.timeline;
    expect(t.searchStarted).not.toBeNull();
    expect(t.searchStarted!).toBeLessThanOrEqual(t.decided);
    expect(a.items.map((p) => p.id)).toEqual(["a", "b"]);
    expect(a.items.every((p) => typeof p.buy.ok === "boolean")).toBe(true); // the kernel's buy rule ran on each
    expect(validateSpec(a.spec, specData(a.items))).toEqual([]);
    expect(a.spec.elements.body).toMatchObject({ type: "Products", props: { ids: ["a", "b"] } });
  });

  it("on a miss, the alternatives were already searched at the same time, before the model finished", async () => {
    const log: string[] = [];
    streamingModel(PLAN, log);
    mocks.search.mockImplementation(async (q: { q: string; category?: string }) => {
      log.push(`search ${q.q} in ${q.category ?? "all"}`);
      return q.q === "driver" ? { items: [card("d")], total: 1 } : { items: [], total: 0 };
    });
    const { ask } = await import("./agent");
    const events: AnswerEvent[] = [];
    const a = await ask("a drill", undefined, (e) => events.push(e));

    expect(log).toEqual(["search drill in Tools", "search drill in all", "search driver in all", "model finished"]);
    const items = events.filter((e) => e.type === "items");
    expect(items).toHaveLength(1); // the empty early result was never shown
    expect(items[0]).toMatchObject({ searched: { query: "driver", category: "" } });
    expect(a.plan.query).toBe("driver");
    expect(a.trace.stages.find((s) => s.name === "execute")?.detail).toContain("broadened after a miss");
  });

  it("for a comparison, prefers the first keywords that find two products, and says so when it substituted", async () => {
    streamingModel({ ...PLAN, layout: "compare", query: "shop vac", category: "", alternatives: ["vacuum hose", "wet dry vac"] }, []);
    mocks.search.mockImplementation(async (q: { q: string }) =>
      q.q === "shop vac" ? { items: [], total: 0 } : q.q === "vacuum hose" ? { items: [card("h")], total: 1 } : { items: [card("v1"), card("v2")], total: 2 },
    );
    const { ask } = await import("./agent");
    const events: AnswerEvent[] = [];
    const a = await ask("compare shop vacs", undefined, (e) => events.push(e));
    expect(a.items.map((p) => p.id)).toEqual(["v1", "v2"]);
    expect(events.find((e) => e.type === "items")).toMatchObject({ searched: { query: "wet dry vac", broadenedFrom: "shop vac" } });
    expect(a.spec.elements.body).toMatchObject({ type: "Compare" });
    expect((a.spec.elements.filters!.props as { note?: string }).note).toContain("No exact match for “shop vac”");
  });

  it("works with no listener (the conformance gate)", async () => {
    streamingModel(PLAN, []);
    mocks.search.mockResolvedValue({ items: [card("a")], total: 1 });
    const { ask } = await import("./agent");
    const a = await ask("a drill");
    expect(a.items).toHaveLength(1);
    expect(a.trace.timeline.products).not.toBeNull();
  });
});
