import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/lib/product";

// No real database: the catalog returns one fixed product, or none.
const fake = vi.hoisted(() => ({ configured: true, products: new Map<string, unknown>(), lookups: [] as string[] }));

vi.mock("@/lib/catalog", () => ({
  catalogConfigured: () => fake.configured,
  async product(id: string) {
    fake.lookups.push(id);
    return fake.products.get(id) ?? null;
  },
}));

import { POST } from "./route";

const TEST_KEY = "sk_test_not_a_real_key_123";
const ID = "6151d6a3c1f2a0b4e8d7c9f1";
const SESSION = "cs_test_a1B2c3D4e5";
const CHECKOUT_PAGE = `https://checkout.stripe.com/c/pay/${SESSION}`;

const PRODUCT = {
  id: ID,
  name: "Cordless Drill Kit",
  image: "https://images.example.test/drill_400.jpg",
  blurb: "",
  brand: null,
  price: 19.99,
  currency: "USD",
  inStock: true,
  category: null,
  rating: null,
  reviews: null,
  images: [],
  description: "",
  highlights: [],
  categories: [],
  color: null,
  specs: [],
  sourceHost: null,
} satisfies Product;

const fetchMock = vi.fn<typeof fetch>();

function buy(fields: Record<string, string>) {
  return POST(new Request("https://shop.test/api/checkout", { method: "POST", body: new URLSearchParams(fields) }));
}

/** The fields the route sent to Stripe. */
const sentToStripe = () => new URLSearchParams(String(fetchMock.mock.calls[0]![1]?.body));

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", TEST_KEY);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => Response.json({ id: SESSION, url: CHECKOUT_PAGE }));
  fake.configured = true;
  fake.products = new Map([[ID, PRODUCT]]);
  fake.lookups = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/checkout", () => {
  it("sends the shopper to the Stripe checkout page for a product that can be bought", async () => {
    const res = await buy({ id: ID });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(CHECKOUT_PAGE);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const sent = sentToStripe();
    expect(sent.get("line_items[0][price_data][unit_amount]")).toBe("1999");
    expect(sent.get("line_items[0][quantity]")).toBe("1");
    expect(sent.get("shipping_options[0][shipping_rate_data][fixed_amount][amount]")).toBe("995");
    expect(sent.get("cancel_url")).toBe(`https://shop.test/p/${ID}`);
    expect(sent.get("success_url")).toBe("https://shop.test/order/success?session_id={CHECKOUT_SESSION_ID}");
    expect(sent.get("metadata[product_id]")).toBe(ID);
  });

  it("charges the catalog price whatever price, amount or quantity the browser sends", async () => {
    const res = await buy({ id: ID, price: "0.01", amount: "1", unit_amount: "1", quantity: "50", currency: "eur" });
    expect(res.status).toBe(303);
    const sent = sentToStripe();
    expect(sent.get("line_items[0][price_data][unit_amount]")).toBe("1999");
    expect(sent.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(sent.get("line_items[0][quantity]")).toBe("1");
  });

  it("returns 404 for an unknown or missing product ID without calling Stripe", async () => {
    expect((await buy({ id: "000000000000000000000000" })).status).toBe(404);
    expect((await buy({})).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for products with no price, no stock or another currency", async () => {
    for (const change of [{ price: null }, { inStock: false }, { currency: "CAD" }]) {
      fake.products.set(ID, { ...PRODUCT, ...change });
      expect((await buy({ id: ID })).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 with a live key, no key or no catalog, without calling Stripe or the catalog", async () => {
    for (const key of ["sk_live_not_a_real_key_123", ""]) {
      vi.stubEnv("STRIPE_SECRET_KEY", key);
      expect((await buy({ id: ID })).status).toBe(503);
    }
    vi.stubEnv("STRIPE_SECRET_KEY", TEST_KEY);
    fake.configured = false;
    expect((await buy({ id: ID })).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fake.lookups).toEqual([]);
  });

  it("returns 502 when Stripe refuses", async () => {
    fetchMock.mockImplementation(async () => Response.json({ error: { message: "bad" } }, { status: 400 }));
    const res = await buy({ id: ID });
    expect(res.status).toBe(502);
    expect(res.headers.get("location")).toBeNull();
  });

  it("caps the product ID length before the catalog lookup", async () => {
    await buy({ id: "x".repeat(500) });
    expect(fake.lookups[0]).toHaveLength(64);
  });
});
