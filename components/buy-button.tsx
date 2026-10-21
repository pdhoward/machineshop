import { ShoppingBag } from "lucide-react";

/** Buy now: a plain form that sends only the product ID to the server, which opens Stripe's checkout. Works without JavaScript. */
export function BuyButton({ productId }: { productId: string }) {
  return (
    <form action="/api/checkout" method="post" className="self-start">
      <input type="hidden" name="id" value={productId} />
      <button
        type="submit"
        className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] font-semibold text-bg transition-colors hover:bg-fog"
      >
        <ShoppingBag className="size-4" /> Buy now
      </button>
    </form>
  );
}
