/**
 * Projections (gen3-cradle.md §2.7, backlog B4): the policy book compiled by
 * the model into settings the store applies in microseconds. They are
 * recompiled whenever the book's version changes, so a ruling changes what
 * the store does with no code change. Pure: unit tested.
 */

export type Projection = {
  summary: string;
  buy: {
    enabled: boolean;
    requireInStock: boolean;
    unknownStockIsOut: boolean;
    requirePositivePrice: boolean;
    currency: string;
    reasonWhenOutOfStock: string;
    reasonWhenNoPrice: string;
    policies: string[];
  };
  search: { hideOutOfStockByDefault: boolean; policies: string[] };
  notices: { productPage: string; footer: string; orderTestMode: string; orderLiveMode: string; policies: string[] };
  assistant: { rules: string[]; mayDirectToBuyNow: boolean; policies: string[] };
};

const strs = { type: "array", items: { type: "string" } } as const;

export const PROJECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "buy", "search", "notices", "assistant"],
  properties: {
    summary: { type: "string" },
    buy: {
      type: "object",
      additionalProperties: false,
      required: ["enabled", "requireInStock", "unknownStockIsOut", "requirePositivePrice", "currency", "reasonWhenOutOfStock", "reasonWhenNoPrice", "policies"],
      properties: {
        enabled: { type: "boolean" },
        requireInStock: { type: "boolean" },
        unknownStockIsOut: { type: "boolean" },
        requirePositivePrice: { type: "boolean" },
        currency: { type: "string" },
        reasonWhenOutOfStock: { type: "string" },
        reasonWhenNoPrice: { type: "string" },
        policies: strs,
      },
    },
    search: {
      type: "object",
      additionalProperties: false,
      required: ["hideOutOfStockByDefault", "policies"],
      properties: { hideOutOfStockByDefault: { type: "boolean" }, policies: strs },
    },
    notices: {
      type: "object",
      additionalProperties: false,
      required: ["productPage", "footer", "orderTestMode", "orderLiveMode", "policies"],
      properties: { productPage: { type: "string" }, footer: { type: "string" }, orderTestMode: { type: "string" }, orderLiveMode: { type: "string" }, policies: strs },
    },
    assistant: {
      type: "object",
      additionalProperties: false,
      required: ["rules", "mayDirectToBuyNow", "policies"],
      properties: { rules: strs, mayDirectToBuyNow: { type: "boolean" }, policies: strs },
    },
  },
} as const;

/** Until the book is compiled (or if it can't be): the safe settings. Nothing can be bought. */
export const SAFE_PROJECTION: Projection = {
  summary: "The policy book isn't available, so the store runs on safe settings: browsing only.",
  buy: { enabled: false, requireInStock: true, unknownStockIsOut: true, requirePositivePrice: true, currency: "USD", reasonWhenOutOfStock: "Out of stock.", reasonWhenNoPrice: "No price yet.", policies: [] },
  search: { hideOutOfStockByDefault: false, policies: [] },
  notices: { productPage: "Test store: no real charges.", footer: "This is a test store.", orderTestMode: "Test mode: no charge was made and nothing ships.", orderLiveMode: "We ship your order to the address you gave at checkout.", policies: [] },
  assistant: { rules: ["Help shoppers browse and choose. Ordering is unavailable right now."], mayDirectToBuyNow: false, policies: [] },
};

export type Stock = "in" | "out" | "unknown";

/** The catalog's raw stock field, read strictly: only an explicit TRUE or FALSE is clear. */
export function stockOf(raw: unknown): Stock {
  const s = String(raw ?? "").trim().toUpperCase();
  return s === "TRUE" ? "in" : s === "FALSE" ? "out" : "unknown";
}

export type BuyDecision = { ok: boolean; reason: string; policies: string[] };

/** Whether this product can be bought now, under the rules in force. The checkout kernel checks this again. */
export function buyDecision(p: { price: number | null; currency: string; stock: Stock }, proj: Projection, checkoutReady: boolean): BuyDecision {
  const policies = proj.buy.policies;
  if (!proj.buy.enabled) return { ok: false, reason: "Ordering is off under the current rules.", policies };
  if (!checkoutReady) return { ok: false, reason: "Checkout isn't connected.", policies };
  if (proj.buy.requirePositivePrice && !(typeof p.price === "number" && p.price > 0)) return { ok: false, reason: proj.buy.reasonWhenNoPrice, policies };
  if (proj.buy.currency && (p.currency || "USD").toUpperCase() !== proj.buy.currency.toUpperCase()) return { ok: false, reason: `Sold only in ${proj.buy.currency}.`, policies };
  if (proj.buy.requireInStock && (p.stock === "out" || (proj.buy.unknownStockIsOut && p.stock === "unknown"))) return { ok: false, reason: proj.buy.reasonWhenOutOfStock, policies };
  return { ok: true, reason: "Can be bought now.", policies };
}
