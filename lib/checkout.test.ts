import { describe, expect, it } from "vitest";

import { SHIPPING_COUNTRIES, SHIPPING_FLAT_CENTS, amountCents, canBuy, checkoutParams, isTestKey } from "./checkout";

const PRODUCT = {
  id: "6151d6a3c1f2a0b4e8d7c9f1",
  name: "Cordless Drill Kit",
  image: "https://images.example.test/drill_400.jpg",
  price: 19.99,
  currency: "USD",
  inStock: true,
};

describe("canBuy", () => {
  it("allows a priced, in-stock, US dollar product", () => {
    expect(canBuy(PRODUCT)).toBe(true);
    expect(canBuy({ ...PRODUCT, currency: "usd" })).toBe(true);
    expect(canBuy({ ...PRODUCT, currency: "" })).toBe(true);
  });

  it("refuses products with no price, a zero or invalid price, no stock, or another currency", () => {
    expect(canBuy({ ...PRODUCT, price: null })).toBe(false);
    expect(canBuy({ ...PRODUCT, price: 0 })).toBe(false);
    expect(canBuy({ ...PRODUCT, price: -5 })).toBe(false);
    expect(canBuy({ ...PRODUCT, price: Number.NaN })).toBe(false);
    expect(canBuy({ ...PRODUCT, price: Number.POSITIVE_INFINITY })).toBe(false);
    expect(canBuy({ ...PRODUCT, inStock: false })).toBe(false);
    expect(canBuy({ ...PRODUCT, currency: "CAD" })).toBe(false);
  });
});

describe("amountCents", () => {
  it("converts dollars to whole cents", () => {
    expect(amountCents(19.99)).toBe(1999);
    expect(amountCents(1234.5)).toBe(123450);
    expect(amountCents(0.01)).toBe(1);
  });

  it("does not lose a cent to float noise and rounds half cents up", () => {
    expect(amountCents(4.35)).toBe(435);
    expect(amountCents(0.1 + 0.2)).toBe(30);
    expect(amountCents(1.005)).toBe(101);
  });

  it("throws for zero, negative, tiny and non-finite prices", () => {
    for (const p of [0, -1, 0.001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => amountCents(p)).toThrow(/Invalid price/);
    }
  });
});

describe("isTestKey", () => {
  it("accepts Stripe test secret and restricted keys", () => {
    expect(isTestKey("sk_test_abc123")).toBe(true);
    expect(isTestKey("rk_test_abc123")).toBe(true);
  });

  it("refuses live, publishable, empty and missing keys", () => {
    for (const k of ["sk_live_abc123", "rk_live_abc123", "pk_test_abc123", "sk_test_", "", " sk_test_abc", null, undefined]) {
      expect(isTestKey(k)).toBe(false);
    }
  });
});

describe("checkoutParams", () => {
  const params = checkoutParams(PRODUCT, "https://shop.test/");

  it("charges the catalog price for one product", () => {
    expect(params.mode).toBe("payment");
    expect(params.line_items).toEqual([
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: 1999,
          product_data: { name: "Cordless Drill Kit", images: ["https://images.example.test/drill_400.jpg"] },
        },
      },
    ]);
    expect(params.metadata).toEqual({ product_id: PRODUCT.id });
  });

  it("ships to US addresses only at the flat rate", () => {
    expect(SHIPPING_COUNTRIES).toEqual(["US"]);
    expect(SHIPPING_FLAT_CENTS).toBe(995);
    expect(params.shipping_address_collection).toEqual({ allowed_countries: ["US"] });
    expect(params.shipping_options).toEqual([
      {
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: "Flat rate shipping",
          fixed_amount: { amount: 995, currency: "usd" },
        },
      },
    ]);
  });

  it("returns to the order page on success and the product page on cancel", () => {
    expect(params.success_url).toBe("https://shop.test/order/success?session_id={CHECKOUT_SESSION_ID}");
    expect(params.cancel_url).toBe(`https://shop.test/p/${PRODUCT.id}`);
    expect(checkoutParams({ ...PRODUCT, id: "a/b" }, "http://localhost:3100").cancel_url).toBe("http://localhost:3100/p/a%2Fb");
  });

  it("sends no image when the product has none or it is not https", () => {
    expect(checkoutParams({ ...PRODUCT, image: null }, "https://shop.test").line_items[0]!.price_data.product_data).toEqual({
      name: "Cordless Drill Kit",
    });
    expect(
      checkoutParams({ ...PRODUCT, image: "http://images.example.test/a.jpg" }, "https://shop.test").line_items[0]!.price_data
        .product_data.images,
    ).toBeUndefined();
  });

  it("refuses products that cannot be bought", () => {
    expect(() => checkoutParams({ ...PRODUCT, price: null }, "https://shop.test")).toThrow(/cannot be bought/);
    expect(() => checkoutParams({ ...PRODUCT, inStock: false }, "https://shop.test")).toThrow(/cannot be bought/);
    expect(() => checkoutParams({ ...PRODUCT, currency: "EUR" }, "https://shop.test")).toThrow(/cannot be bought/);
  });
});
