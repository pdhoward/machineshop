import { describe, expect, it } from "vitest";

import { buyDecision, SAFE_PROJECTION, stockOf, type Projection } from "./projection";

// The ruling on C-INV-1 / S-CHECKO-3: only a clear in-stock status can be bought; missing or unclear is out.
const rules: Projection = {
  ...SAFE_PROJECTION,
  buy: { enabled: true, requireInStock: true, unknownStockIsOut: true, requirePositivePrice: true, currency: "USD", reasonWhenOutOfStock: "Out of stock.", reasonWhenNoPrice: "No price.", policies: ["C-INV-1"] },
};
const product = (over: Partial<{ price: number | null; currency: string; stock: "in" | "out" | "unknown" }> = {}) => ({ price: 25, currency: "USD", stock: "in" as const, ...over });

describe("stockOf", () => {
  it("reads only an explicit TRUE or FALSE as clear", () => {
    expect(stockOf("TRUE")).toBe("in");
    expect(stockOf(" false ")).toBe("out");
    for (const v of [undefined, null, "", "yes", "limited", 1]) expect(stockOf(v)).toBe("unknown");
  });
});

describe("buyDecision", () => {
  it("allows a priced, in-stock, US-dollar product", () => {
    expect(buyDecision(product(), rules, true)).toMatchObject({ ok: true, policies: ["C-INV-1"] });
  });
  it("treats unclear stock as out of stock under the ruling", () => {
    expect(buyDecision(product({ stock: "unknown" }), rules, true)).toMatchObject({ ok: false, reason: "Out of stock." });
    expect(buyDecision(product({ stock: "out" }), rules, true).ok).toBe(false);
  });
  it("follows the book when the ruling changes", () => {
    const relaxed = { ...rules, buy: { ...rules.buy, unknownStockIsOut: false } };
    expect(buyDecision(product({ stock: "unknown" }), relaxed, true).ok).toBe(true);
  });
  it("refuses no price, other currencies, no checkout and the safe settings", () => {
    expect(buyDecision(product({ price: null }), rules, true).ok).toBe(false);
    expect(buyDecision(product({ price: 0 }), rules, true).ok).toBe(false);
    expect(buyDecision(product({ currency: "EUR" }), rules, true).ok).toBe(false);
    expect(buyDecision(product(), rules, false).ok).toBe(false);
    expect(buyDecision(product(), SAFE_PROJECTION, true).ok).toBe(false);
  });
});
