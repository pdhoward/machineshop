/**
 * Buy now rules for Stripe Checkout (test mode only). Pure (no network, no
 * environment), so every rule is unit tested. One product per order, quantity
 * 1, US shipping at one flat rate. The amount always comes from the catalog
 * product, never from the browser.
 */

import { money, type ProductCard } from "./product";
import type { CheckoutSummary } from "./stripe";

export const SHIPPING_FLAT_CENTS = 995;
export const SHIPPING_COUNTRIES = ["US"] as const;

type Buyable = Pick<ProductCard, "price" | "currency" | "inStock">;

/** A product can be bought when it has a price above 0, is in stock and is priced in US dollars. */
export const canBuy = (p: Buyable) =>
  typeof p.price === "number" && Number.isFinite(p.price) && p.price > 0 && p.inStock && (p.currency || "USD").toUpperCase() === "USD";

/** Dollars → whole cents, half cents rounded up. Throws for zero, negative and non-finite prices. */
export function amountCents(price: number): number {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) throw new Error(`Invalid price: ${price}`);
  // toFixed first, so float noise (4.35 * 100 = 434.99999999999994) cannot lose a cent.
  const cents = Math.round(Number((price * 100).toFixed(2)));
  if (cents < 1) throw new Error(`Invalid price: ${price}`);
  return cents;
}

/** Only Stripe test keys (secret or restricted) pass; live, empty and missing keys fail. */
export const isTestKey = (key: string | null | undefined) => typeof key === "string" && /^(sk|rk)_test_\S+$/.test(key);

export type CheckoutParams = {
  mode: "payment";
  line_items: {
    quantity: 1;
    price_data: { currency: "usd"; unit_amount: number; product_data: { name: string; images?: string[] } };
  }[];
  shipping_address_collection: { allowed_countries: string[] };
  shipping_options: {
    shipping_rate_data: {
      type: "fixed_amount";
      display_name: string;
      fixed_amount: { amount: number; currency: "usd" };
    };
  }[];
  success_url: string;
  cancel_url: string;
  metadata: { product_id: string };
};

/**
 * The Stripe Checkout Session fields for one catalog product on `origin`.
 * Throws when the product cannot be bought, so no caller can skip `canBuy`.
 */
export function checkoutParams(p: Buyable & Pick<ProductCard, "id" | "name" | "image">, origin: string): CheckoutParams {
  if (!canBuy(p)) throw new Error(`Product ${p.id} cannot be bought`);
  const base = origin.replace(/\/+$/, "");
  return {
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents(p.price!),
          product_data: { name: p.name, ...(p.image && /^https:\/\//.test(p.image) ? { images: [p.image] } : {}) },
        },
      },
    ],
    shipping_address_collection: { allowed_countries: [...SHIPPING_COUNTRIES] },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: "Flat rate shipping",
          fixed_amount: { amount: SHIPPING_FLAT_CENTS, currency: "usd" },
        },
      },
    ],
    // Stripe replaces {CHECKOUT_SESSION_ID} itself; it must stay unencoded.
    success_url: `${base}/order/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/p/${encodeURIComponent(p.id)}`,
    metadata: { product_id: p.id },
  };
}

/** The product page shows "Buy now" only when Stripe has a test key and the product can be bought. */
export const showBuyNow = (p: Buyable, stripeReady: boolean) => stripeReady && canBuy(p);

export type OrderSummary = { product: string; total: string; reference: string };

/** What the "Order received" page shows: product, total and Stripe reference. Null unless the checkout is paid. */
export function orderSummary(c: CheckoutSummary | null): OrderSummary | null {
  if (!c?.paid) return null;
  return {
    product: c.productName || "Your product",
    total: c.totalCents == null ? "Total unavailable" : money(c.totalCents / 100, c.currency || "USD"),
    reference: c.reference,
  };
}
