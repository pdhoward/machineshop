import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductCard } from "@/lib/product";

// No real database: the catalog is mocked with two real products, the voice store holds sessions in memory.
const card = (id: string, name: string, price: number | null): ProductCard => ({
  id, name, image: null, blurb: `${name}.`, brand: "Acme", price, currency: "USD", inStock: true, category: "Tools", rating: null, reviews: null,
});
const DRILL = card("aaaaaaaaaaaaaaaaaaaaaaaa", "Cordless Drill", 1299.5);
const LAMP = card("bbbbbbbbbbbbbbbbbbbbbbbb", "Brass Lamp", 45);
const REAL = new Map([DRILL, LAMP].map((c) => [c.id, c]));

const catalog = vi.hoisted(() => ({ catalogConfigured: vi.fn(() => true), search: vi.fn(), product: vi.fn(), cardsByIds: vi.fn() }));
vi.mock("@/lib/catalog", () => catalog);

type FakeSession = { id: string; start: Date; endsAt: Date; endedAt: Date | null };
const fake = vi.hoisted(() => ({ sessions: new Map<string, FakeSession>() }));
vi.mock("@/lib/voice-store", () => ({ voiceStore: () => ({ session: async (id: string) => fake.sessions.get(id) ?? null }) }));

import { CALL_MS } from "@/lib/voice";
import { signSessionToken } from "@/lib/voice-token";

import { POST } from "./route";

const T0 = new Date("2026-10-15T12:00:00.000Z");
const MIN = 60_000;
const SECRET = "test-voice-secret";

const ENV = {
  OPENAI_API_KEY: "sk-test-not-a-real-key-123",
  VOICE_MODEL: "gpt-realtime-test",
  VOICE_ACCESS_CODE: "test-access-code",
  VOICE_OWNER_CODE: "test-owner-code",
  VOICE_SECRET: SECRET,
  VOICE_MONGODB_URI: "mongodb://voice.test/fake",
  VOICE_MONGODB_DB: "voice_test",
};

const ENDS = new Date(T0.getTime() + CALL_MS);
const tokenFor = (sessionId: string, secret = SECRET) => signSessionToken({ sessionId, endsAt: ENDS }, secret);

function call(body: unknown, token?: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return POST(new Request("http://shop.test/api/voice/tool", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
}

const search = (token: string | null = tokenFor("live")) => call({ name: "search_products", arguments: JSON.stringify({ query: "drill" }) }, token);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0.getTime() + MIN));
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.clearAllMocks();
  catalog.catalogConfigured.mockReturnValue(true);
  catalog.search.mockResolvedValue({ items: [DRILL, LAMP], total: 2 });
  catalog.product.mockResolvedValue(null);
  catalog.cardsByIds.mockImplementation(async (ids: string[]) => ids.map((id) => REAL.get(id)).filter(Boolean));
  fake.sessions.clear();
  fake.sessions.set("live", { id: "live", start: T0, endsAt: ENDS, endedAt: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const catalogUntouched = () => {
  expect(catalog.search).not.toHaveBeenCalled();
  expect(catalog.product).not.toHaveBeenCalled();
  expect(catalog.cardsByIds).not.toHaveBeenCalled();
};

describe("refusals", () => {
  it("returns 503 when Talk or the catalog isn't configured", async () => {
    vi.stubEnv("VOICE_SECRET", "");
    expect((await search()).status).toBe(503);
    vi.stubEnv("VOICE_SECRET", SECRET);
    catalog.catalogConfigured.mockReturnValue(false);
    expect((await search()).status).toBe(503);
    catalogUntouched();
  });

  it("refuses a missing token", async () => {
    const res = await search(null);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ reason: "no_call" });
    catalogUntouched();
  });

  it("refuses a forged or tampered token", async () => {
    expect((await search(tokenFor("live", "someone-elses-secret"))).status).toBe(401);
    // Stretching the end time breaks the signature.
    const [id, , sig] = tokenFor("live").split(".");
    expect((await search(`${id}.${ENDS.getTime() + 60 * MIN}.${sig}`)).status).toBe(401);
    expect((await search("live.123.abc")).status).toBe(401);
    catalogUntouched();
  });

  it("refuses a validly signed token for a call the store doesn't know", async () => {
    expect((await search(tokenFor("unknown"))).status).toBe(401);
    catalogUntouched();
  });

  it("refuses at 5:00 and after (the server-side cap)", async () => {
    vi.setSystemTime(new Date(ENDS.getTime() - 1));
    expect((await search()).status).toBe(200);
    vi.setSystemTime(ENDS);
    const res = await search();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "ended" });
    vi.setSystemTime(new Date(ENDS.getTime() + 10 * MIN));
    expect((await search()).status).toBe(403);
    expect(catalog.search).toHaveBeenCalledTimes(1);
  });

  it("refuses a call that was hung up early", async () => {
    fake.sessions.set("live", { id: "live", start: T0, endsAt: ENDS, endedAt: T0 });
    expect((await search()).status).toBe(403);
    catalogUntouched();
  });

  it("refuses an oversized request", async () => {
    const res = await call({ name: "search_products", arguments: JSON.stringify({ query: "x".repeat(10_000) }) }, tokenFor("live"));
    expect(res.status).toBe(413);
    catalogUntouched();
  });
});

describe("running skills", () => {
  it("returns catalog search results as the model's output, with the found cards", async () => {
    const res = await search();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["output", "found"]);
    expect(body.found).toEqual([DRILL, LAMP]);
    expect(catalog.search).toHaveBeenCalledWith({ q: "drill", maxPrice: undefined, minPrice: undefined, inStockOnly: false }, 1, 12);
    expect(JSON.parse(body.output)).toEqual({
      total: 2,
      products: [
        { id: DRILL.id, name: "Cordless Drill", price: "$1,299.50", inStock: true, category: "Tools", blurb: "Cordless Drill." },
        { id: LAMP.id, name: "Brass Lamp", price: "$45.00", inStock: true, category: "Tools", blurb: "Brass Lamp." },
      ],
    });
  });

  it("accepts arguments as an object as well as a JSON string", async () => {
    await call({ name: "search_products", arguments: { query: "lamp", max_price: 50 } }, tokenFor("live"));
    expect(catalog.search).toHaveBeenCalledWith(expect.objectContaining({ q: "lamp", maxPrice: 50 }), 1, 12);
  });

  it("returns the real product cards for show_products, only real ones and at most 6", async () => {
    const ids = ["x1", DRILL.id, "x2", LAMP.id, "x3", "x4", "x5"];
    const res = await call({ name: "show_products", arguments: JSON.stringify({ ids }) }, tokenFor("live"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ output: "Shown.", products: [DRILL, LAMP] });
    expect(catalog.cardsByIds).toHaveBeenCalledWith(ids.slice(0, 6));
  });

  it("search replies carry at most the first 3 catalog cards as found, and no products", async () => {
    const more = ["c", "d", "e"].map((ch, i) => card(ch.repeat(24), `Saw ${i}`, 10));
    catalog.search.mockResolvedValueOnce({ items: [DRILL, LAMP, ...more], total: 5 });
    const body = await (await search()).json();
    expect(body.found).toEqual([DRILL, LAMP, more[0]]);
    expect(body).not.toHaveProperty("products");
    expect(catalog.cardsByIds).not.toHaveBeenCalled();
  });

  it("a search with no matches carries no cards", async () => {
    catalog.search.mockResolvedValueOnce({ items: [], total: 0 });
    expect(Object.keys(await (await search()).json())).toEqual(["output"]);
  });

  it("lookup replies carry that one catalog product as found, as a card", async () => {
    catalog.product.mockImplementation(async (id: string) =>
      id === DRILL.id ? { ...DRILL, images: [], description: "A strong drill.", highlights: [], categories: ["Tools"], color: null, specs: [], sourceHost: null } : null,
    );
    const res = await call({ name: "get_product", arguments: JSON.stringify({ id: DRILL.id }) }, tokenFor("live"));
    const body = await res.json();
    expect(body.found).toEqual([DRILL]);
    expect(JSON.parse(body.output)).toMatchObject({ id: DRILL.id, name: "Cordless Drill" });
    expect(body).not.toHaveProperty("products");
  });

  it("show_products returns products, never found, and at most 6 even when more are real", async () => {
    const many = Array.from({ length: 8 }, (_, i) => card(String(i).repeat(24), `Thing ${i}`, 5));
    for (const c of many) REAL.set(c.id, c);
    try {
      const res = await call({ name: "show_products", arguments: JSON.stringify({ ids: many.map((c) => c.id) }) }, tokenFor("live"));
      const body = await res.json();
      expect(body.products).toEqual(many.slice(0, 6));
      expect(body).not.toHaveProperty("found");
    } finally {
      for (const c of many) REAL.delete(c.id);
    }
  });

  it("refusals carry no cards", async () => {
    const noCards = async (res: Response) => {
      const body = await res.json();
      expect(body).not.toHaveProperty("found");
      expect(body).not.toHaveProperty("products");
    };
    await noCards(await search(null));
    fake.sessions.set("live", { id: "live", start: T0, endsAt: ENDS, endedAt: T0 });
    await noCards(await search());
    fake.sessions.set("live", { id: "live", start: T0, endsAt: ENDS, endedAt: null });
    vi.setSystemTime(ENDS);
    await noCards(await search());
    await noCards(await call({ name: "show_products", arguments: JSON.stringify({ ids: [DRILL.id] }) }, tokenFor("live")));
    catalogUntouched();
  });

  it("passes back the catalog's answer for a missing product", async () => {
    const res = await call({ name: "get_product", arguments: JSON.stringify({ id: "cccccccccccccccccccccccc" }) }, tokenFor("live"));
    expect(await res.json()).toEqual({ output: JSON.stringify({ error: "No product with that id." }) });
  });

  it("refuses unknown skills and unreadable arguments without touching the catalog", async () => {
    const res = await call({ name: "place_order", arguments: "{not json" }, tokenFor("live"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ output: JSON.stringify({ error: "Unknown tool place_order" }) });
    expect(await (await call("not json at all", tokenFor("live"))).json()).toEqual({ output: JSON.stringify({ error: "Unknown tool " }) });
    catalogUntouched();
  });

  it("returns 502 when the catalog fails", async () => {
    catalog.search.mockRejectedValueOnce(new Error("down"));
    expect((await search()).status).toBe(502);
  });
});
