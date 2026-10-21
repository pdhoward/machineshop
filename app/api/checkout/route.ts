import { canBuy, checkoutParams } from "@/lib/checkout";
import { catalogConfigured, product } from "@/lib/catalog";
import { createCheckout, stripeReady } from "@/lib/stripe";

/**
 * Buy now. POST a form with the product `id` only. The server loads the
 * product from the catalog, checks it can be bought, creates a Stripe test
 * checkout and sends the shopper there (303). Any price, amount or quantity
 * in the request is ignored.
 */

const MAX_ID_CHARS = 64;

const fail = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!stripeReady() || !catalogConfigured()) return fail("Checkout isn't set up yet.", 503);

  const form = await request.formData().catch(() => null);
  const raw = form?.get("id");
  const id = typeof raw === "string" ? raw.trim().slice(0, MAX_ID_CHARS) : "";

  try {
    const p = id ? await product(id) : null;
    if (!p) return fail("We couldn't find that product.", 404);
    if (!canBuy(p)) return fail("This product can't be bought online.", 400);

    const { url } = await createCheckout(checkoutParams(p, new URL(request.url).origin));
    return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[checkout]", err instanceof Error ? err.message : err);
    return fail("Couldn't start checkout. Try again in a moment.", 502);
  }
}
