import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductCard } from "./product";

// The catalog is mocked: no database. Two real products exist, every other id is unknown.
const card = (id: string, name: string, price: number | null): ProductCard => ({
  id, name, image: null, blurb: `${name}.`, brand: "Acme", price, currency: "USD", inStock: true, category: "Tools", rating: null, reviews: null,
});
const DRILL = card("aaaaaaaaaaaaaaaaaaaaaaaa", "Cordless Drill", 1299.5);
const LAMP = card("bbbbbbbbbbbbbbbbbbbbbbbb", "Brass Lamp", null);
const REAL = new Map([DRILL, LAMP].map((c) => [c.id, c]));

const catalog = vi.hoisted(() => ({ search: vi.fn(), product: vi.fn(), cardsByIds: vi.fn() }));
vi.mock("./catalog", () => catalog);

import { assistantInstructions, MAX_SHOWN, runTool, SKILLS } from "./assistant-tools";

beforeEach(() => {
  vi.clearAllMocks();
  catalog.search.mockResolvedValue({ items: [DRILL, LAMP], total: 2 });
  catalog.product.mockImplementation(async (id: string) =>
    REAL.has(id)
      ? ({ ...REAL.get(id)!, images: [], description: "A strong drill.", highlights: ["Brushless"], categories: ["Tools", "Drills"], color: null, specs: [{ label: "Volts", value: "20" }], sourceHost: null } satisfies Product)
      : null,
  );
  catalog.cardsByIds.mockImplementation(async (ids: string[]) => ids.map((id) => REAL.get(id)).filter(Boolean));
});

describe("skills", () => {
  it("are exactly the three catalog skills", () => {
    expect(SKILLS.map((s) => s.name)).toEqual(["search_products", "get_product", "show_products"]);
    for (const s of SKILLS) expect(s.parameters.type).toBe("object");
  });

  it("share the only-real-products rule and take the reply style", () => {
    const text = assistantInstructions("Speak briefly.");
    expect(text).toContain("Only mention products, prices and specs that came from your tools. Never invent them.");
    expect(text).toContain("at most 6");
    expect(text).toContain("- Speak briefly.");
  });

  it("give typed chat exactly the prompt it had before the move", () => {
    expect(assistantInstructions("Keep replies short and warm: 2 to 5 sentences, plain text, no markdown headings or tables. Mention prices."))
      .toBe(`You are the shop assistant at Machine Shop, an online store of about 10,000 home and workshop products (tools, decor, lighting, furniture, appliances and more).

How you work:
- Always find products with search_products before recommending anything. Search with short, concrete terms (e.g. "cordless drill", "area rug 8x10"); try a second search with different words if the first finds little.
- Use get_product when the shopper asks about one product's details.
- When you recommend products, call show_products once with the ids (best first, at most 6) so the shopper sees them as cards.
- Only mention products, prices and specs that came from your tools. Never invent them.
- Keep replies short and warm: 2 to 5 sentences, plain text, no markdown headings or tables. Mention prices.
- This is a demonstration store: shoppers can browse and ask, but can't order. If asked to buy, say so kindly and help them choose.`);
  });
});

describe("runTool", () => {
  it("search returns real fields and formatted prices, limited to 12", async () => {
    const out = JSON.parse(await runTool("search_products", { query: "drill", max_price: 2000, in_stock_only: true }, []));
    expect(catalog.search).toHaveBeenCalledWith({ q: "drill", maxPrice: 2000, minPrice: undefined, inStockOnly: true }, 1, 12);
    expect(out.total).toBe(2);
    expect(out.products[0]).toEqual({ id: DRILL.id, name: "Cordless Drill", price: "$1,299.50", inStock: true, category: "Tools", blurb: "Cordless Drill." });
    expect(out.products[1].price).toBe("Price unavailable");
  });

  it("get_product returns details for a real product", async () => {
    const out = JSON.parse(await runTool("get_product", { id: DRILL.id }, []));
    expect(out).toMatchObject({ id: DRILL.id, name: "Cordless Drill", price: "$1,299.50", specs: [{ label: "Volts", value: "20" }] });
  });

  it("get_product returns an error for a missing product", async () => {
    const out = JSON.parse(await runTool("get_product", { id: "cccccccccccccccccccccccc" }, []));
    expect(out).toEqual({ error: "No product with that id." });
  });

  it("show_products caps at 6 and keeps only real cards", async () => {
    const shown: ProductCard[] = [];
    const ids = ["x1", DRILL.id, "x2", "x3", "x4", LAMP.id, "x5", "x6"]; // LAMP is 6th, so kept; nothing past 6 is asked for
    expect(await runTool("show_products", { ids }, shown)).toBe("Shown.");
    expect(MAX_SHOWN).toBe(6);
    expect(catalog.cardsByIds).toHaveBeenCalledWith(ids.slice(0, 6));
    expect(shown).toEqual([DRILL, LAMP]);
  });

  it("show_products drops ids past the sixth even if they are real", async () => {
    const shown: ProductCard[] = [];
    await runTool("show_products", { ids: ["x1", "x2", "x3", "x4", "x5", "x6", DRILL.id] }, shown);
    expect(shown).toEqual([]);
  });

  it("show_products replaces what was shown before", async () => {
    const shown: ProductCard[] = [DRILL];
    await runTool("show_products", { ids: [LAMP.id] }, shown);
    expect(shown).toEqual([LAMP]);
  });

  it("refuses unknown skills without touching the catalog", async () => {
    const out = JSON.parse(await runTool("place_order", { id: DRILL.id }, []));
    expect(out).toEqual({ error: "Unknown tool place_order" });
    expect(catalog.search).not.toHaveBeenCalled();
    expect(catalog.product).not.toHaveBeenCalled();
    expect(catalog.cardsByIds).not.toHaveBeenCalled();
  });
});
