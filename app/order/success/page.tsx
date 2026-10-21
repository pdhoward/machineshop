import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, PackageSearch } from "lucide-react";

import { orderSummary, type OrderSummary } from "@/lib/checkout";
import { getCheckout, stripeReady } from "@/lib/stripe";

// Private: one shopper's order, never indexed or followed by search engines.
export const metadata: Metadata = {
  title: "Order received",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

type Props = { searchParams: Promise<{ session_id?: string | string[] }> };

/** The paid order for this Stripe session, or null if it is missing, unpaid or Stripe can't be reached. */
async function findOrder(sessionId: unknown): Promise<OrderSummary | null> {
  if (typeof sessionId !== "string" || !stripeReady()) return null;
  try {
    return orderSummary(await getCheckout(sessionId));
  } catch (err) {
    console.error("[order/success]", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Where Stripe sends the shopper after payment. Shows the product, total and Stripe reference; never the address. */
export default async function OrderReceivedPage({ searchParams }: Props) {
  const order = await findOrder((await searchParams).session_id);

  return (
    <main className="mx-auto max-w-lg px-4 pt-16 sm:px-6">
      <div className="rounded-2xl border border-line bg-panel p-8 text-center">
        {order ? (
          <>
            <CircleCheck className="mx-auto size-9 text-good" />
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">Order received</h1>
            <p className="mt-2 text-[14px] text-fog">Thank you. We ship your order to the address you gave Stripe.</p>
            <dl className="mt-6 overflow-hidden rounded-xl border border-line text-left text-[14px]">
              <div className="grid grid-cols-[1fr_1.6fr] gap-4 border-b border-line px-4 py-2.5">
                <dt className="text-fog">Product</dt>
                <dd>{order.product}</dd>
              </div>
              <div className="grid grid-cols-[1fr_1.6fr] gap-4 border-b border-line px-4 py-2.5">
                <dt className="text-fog">Total paid</dt>
                <dd className="tabular-nums">{order.total}</dd>
              </div>
              <div className="grid grid-cols-[1fr_1.6fr] gap-4 px-4 py-2.5">
                <dt className="text-fog">Order reference</dt>
                <dd className="break-all font-mono text-[12.5px]">{order.reference}</dd>
              </div>
            </dl>
            <p className="mt-4 text-[12.5px] text-mist">Test store: Stripe test mode. No real charge was made.</p>
          </>
        ) : (
          <>
            <PackageSearch className="mx-auto size-9 text-accent" />
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">We could not find this order</h1>
            <p className="mt-2 text-[14px] text-fog">The link is not complete, or the payment did not finish.</p>
          </>
        )}
        <Link
          href="/"
          className="mt-6 inline-flex items-center rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-on-accent transition-colors hover:bg-accent-2"
        >
          Back to the shop
        </Link>
      </div>
    </main>
  );
}
