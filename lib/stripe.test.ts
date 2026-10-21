import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkoutParams } from "./checkout";
import { createCheckout, formEncode, getCheckout, stripeConfigured, stripeReady } from "./stripe";

const TEST_KEY = "sk_test_not_a_real_key_123";
const SESSION = "cs_test_a1B2c3D4e5";
const CHECKOUT_PAGE = `https://checkout.stripe.com/c/pay/${SESSION}`;
const PRODUCT = { id: "6151d6a3c1f2a0b4e8d7c9f1", name: "Cordless Drill Kit", image: null, price: 19.99, currency: "USD", inStock: true };

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", TEST_KEY);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("stripeConfigured and stripeReady", () => {
  it("are ready only with a test key", () => {
    expect(stripeConfigured()).toBe(true);
    expect(stripeReady()).toBe(true);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_not_a_real_key_123");
    expect(stripeConfigured()).toBe(true);
    expect(stripeReady()).toBe(false);
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(stripeConfigured()).toBe(false);
    expect(stripeReady()).toBe(false);
  });
});

describe("formEncode", () => {
  it("flattens nested fields and lists into Stripe's form encoding", () => {
    const form = formEncode({ mode: "payment", a: [{ b: { c: 1 } }, "x"], skip: undefined, none: null, ok: true });
    expect([...form]).toEqual([
      ["mode", "payment"],
      ["a[0][b][c]", "1"],
      ["a[1]", "x"],
      ["ok", "true"],
    ]);
  });

  it("keeps the checkout session placeholder intact", () => {
    const form = formEncode(checkoutParams(PRODUCT, "https://shop.test"));
    expect(form.get("success_url")).toBe("https://shop.test/order/success?session_id={CHECKOUT_SESSION_ID}");
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("1999");
    expect(form.get("shipping_address_collection[allowed_countries][0]")).toBe("US");
  });
});

describe("createCheckout", () => {
  it("posts the session to Stripe with the key and returns the checkout page", async () => {
    fetchMock.mockResolvedValue(json({ id: SESSION, url: CHECKOUT_PAGE }));
    expect(await createCheckout(checkoutParams(PRODUCT, "https://shop.test"))).toEqual({ id: SESSION, url: CHECKOUT_PAGE });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TEST_KEY}`);
    expect(new URLSearchParams(String(init?.body)).get("line_items[0][quantity]")).toBe("1");
  });

  it("refuses a live or missing key without calling Stripe", async () => {
    for (const key of ["sk_live_not_a_real_key_123", ""]) {
      vi.stubEnv("STRIPE_SECRET_KEY", key);
      await expect(createCheckout(checkoutParams(PRODUCT, "https://shop.test"))).rejects.toThrow(/test key/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when Stripe refuses or returns no Stripe checkout page", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { message: "bad" } }, 400));
    await expect(createCheckout(checkoutParams(PRODUCT, "https://shop.test"))).rejects.toThrow(/400/);
    fetchMock.mockResolvedValueOnce(json({ id: SESSION, url: "https://evil.test/pay" }));
    await expect(createCheckout(checkoutParams(PRODUCT, "https://shop.test"))).rejects.toThrow(/no checkout page/);
  });
});

describe("getCheckout", () => {
  const STRIPE_SESSION = {
    id: SESSION,
    amount_total: 2994,
    currency: "usd",
    payment_status: "paid",
    customer_details: { email: "shopper@example.test", name: "Test Shopper", address: { line1: "1 Test St", country: "US" } },
    shipping_details: { name: "Test Shopper", address: { line1: "1 Test St", city: "Testville", country: "US" } },
    line_items: { data: [{ description: "Cordless Drill Kit", amount_total: 1999 }] },
  };

  it("returns the product, total and reference, and drops the address and email", async () => {
    fetchMock.mockImplementation(async () => json(STRIPE_SESSION));
    const summary = await getCheckout(SESSION);
    expect(summary).toEqual({ reference: SESSION, productName: "Cordless Drill Kit", totalCents: 2994, currency: "USD", paid: true });
    expect(JSON.stringify(summary)).not.toMatch(/Test St|Testville|shopper@|Test Shopper/);
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://api.stripe.com/v1/checkout/sessions/${SESSION}?expand[]=line_items`);
  });

  it("reports an unpaid checkout as not paid", async () => {
    fetchMock.mockResolvedValue(json({ ...STRIPE_SESSION, payment_status: "unpaid" }));
    expect((await getCheckout(SESSION))?.paid).toBe(false);
  });

  it("returns null for malformed or live session IDs without calling Stripe", async () => {
    for (const id of ["", "cs_live_a1B2c3", "cs_test_", "cs_test_abc/../../customers", "pi_test_abc"]) {
      expect(await getCheckout(id)).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for an unknown session and throws on other Stripe errors", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: {} }, 404));
    expect(await getCheckout(SESSION)).toBeNull();
    fetchMock.mockResolvedValueOnce(json({ error: {} }, 500));
    await expect(getCheckout(SESSION)).rejects.toThrow(/500/);
  });
});
