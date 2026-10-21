import "server-only";

import { isTestKey, type CheckoutParams } from "./checkout";

/**
 * Stripe: the only code that talks to Stripe, from the server with plain
 * `fetch`, and only with a test key. It sends no addresses or emails back to
 * the site; Stripe keeps the orders.
 */

const STRIPE_API = "https://api.stripe.com/v1";
const CHECKOUT_URL = /^https:\/\/checkout\.stripe\.com\//;
const SESSION_ID = /^cs_test_[A-Za-z0-9]{1,200}$/;

export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY;

/** True only when STRIPE_SECRET_KEY is a Stripe test key. */
export const stripeReady = () => isTestKey(process.env.STRIPE_SECRET_KEY);

/** Nested fields → Stripe's form encoding: `line_items[0][price_data][currency]=usd`. */
export function formEncode(value: unknown, prefix = "", out = new URLSearchParams()): URLSearchParams {
  if (value == null) return out;
  if (Array.isArray(value)) value.forEach((v, i) => formEncode(v, `${prefix}[${i}]`, out));
  else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) formEncode(v, prefix ? `${prefix}[${k}]` : k, out);
  } else out.append(prefix, String(value));
  return out;
}

function stripeFetch(path: string, init: RequestInit = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!isTestKey(key)) throw new Error("Stripe refused: STRIPE_SECRET_KEY is missing or is not a test key.");
  return fetch(`${STRIPE_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
}

/** Creates a Stripe Checkout Session and returns where to send the shopper. Throws if Stripe refuses. */
export async function createCheckout(params: CheckoutParams): Promise<{ id: string; url: string }> {
  const res = await stripeFetch("/checkout/sessions", { method: "POST", body: formEncode(params).toString() });
  if (!res.ok) throw new Error(`Stripe refused the checkout: ${res.status}`);
  const s = (await res.json()) as { id?: unknown; url?: unknown };
  if (typeof s.id !== "string" || typeof s.url !== "string" || !CHECKOUT_URL.test(s.url)) {
    throw new Error("Stripe returned no checkout page.");
  }
  return { id: s.id, url: s.url };
}

export type CheckoutSummary = {
  reference: string;
  productName: string | null;
  totalCents: number | null;
  currency: string | null;
  paid: boolean;
};

/**
 * What the "Order received" page may show about one checkout: the product,
 * total and reference only. Null for an unknown or malformed session ID.
 */
export async function getCheckout(sessionId: string): Promise<CheckoutSummary | null> {
  if (!SESSION_ID.test(sessionId)) return null;
  const res = await stripeFetch(`/checkout/sessions/${sessionId}?expand[]=line_items`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Stripe refused the checkout lookup: ${res.status}`);
  const s = (await res.json()) as {
    id?: unknown;
    amount_total?: unknown;
    currency?: unknown;
    payment_status?: unknown;
    line_items?: { data?: { description?: unknown }[] };
  };
  const name = s.line_items?.data?.[0]?.description;
  return {
    reference: typeof s.id === "string" ? s.id : sessionId,
    productName: typeof name === "string" ? name : null,
    totalCents: typeof s.amount_total === "number" ? s.amount_total : null,
    currency: typeof s.currency === "string" ? s.currency.toUpperCase() : null,
    paid: s.payment_status === "paid",
  };
}
