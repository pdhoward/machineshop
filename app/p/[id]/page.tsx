import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronRight, Star } from "lucide-react";

import { AskButton } from "@/components/assistant";
import { BuyButton } from "@/components/buy-button";
import { Gallery } from "@/components/gallery";
import { SetupNotice } from "@/components/setup-notice";
import { catalogConfigured, product } from "@/lib/catalog";
import { showBuyNow, TEST_MODE_NOTICE } from "@/lib/checkout";
import { money } from "@/lib/product";
import { stripeReady } from "@/lib/stripe";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!catalogConfigured()) return {};
  const p = await product((await params).id);
  return p ? { title: p.name, description: p.blurb } : {};
}

export default async function ProductPage({ params }: Props) {
  if (!catalogConfigured()) return <SetupNotice />;
  const p = await product((await params).id);
  if (!p) notFound();

  return (
    <main className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[13px] text-fog">
        <Link href="/" className="hover:text-ink">
          Shop
        </Link>
        {p.categories.map((c, i) => (
          <span key={c} className="flex items-center gap-1">
            <ChevronRight className="size-3.5 text-mist" />
            {i === 0 ? (
              <Link href={`/?c=${encodeURIComponent(c)}`} className="hover:text-ink">
                {c}
              </Link>
            ) : (
              <Link href={`/?q=${encodeURIComponent(c)}`} className="hover:text-ink">
                {c}
              </Link>
            )}
          </span>
        ))}
      </nav>

      <div className="grid gap-8 pt-6 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
        <Gallery images={p.images} name={p.name} />

        <div className="flex flex-col gap-5">
          <div>
            {p.brand && <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist">{p.brand}</p>}
            <h1 className="mt-1.5 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{p.name}</h1>
            {p.rating && (
              <p className="mt-2 flex items-center gap-1.5 text-[14px] text-fog">
                <Star className="size-4 fill-accent text-accent" /> {p.rating.toFixed(1)}
                {p.reviews && <span className="text-mist">· {p.reviews} reviews</span>}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-3xl font-semibold tabular-nums">{money(p.price, p.currency)}</span>
            <span className={p.inStock ? "text-[13px] font-medium text-good" : "text-[13px] font-medium text-bad"}>
              {p.inStock ? "In stock" : "Out of stock"}
            </span>
          </div>

          {p.highlights.length > 0 && (
            <ul className="flex flex-col gap-2 border-y border-line py-5">
              {p.highlights.map((h) => (
                <li key={h} className="flex gap-2.5 text-[14px] leading-snug">
                  <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                  {h}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-3">
            {showBuyNow(p, stripeReady()) && <BuyButton productId={p.id} />}
            <AskButton
              prompt={`Tell me about "${p.name}" (product ${p.id}). Is it a good choice, and what would go well with it?`}
              label="Ask about this product"
            />
          </div>
          <p className="text-[12.5px] text-mist">{TEST_MODE_NOTICE}</p>
        </div>
      </div>

      <div className="grid gap-8 pt-14 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
        {p.description && (
          <section>
            <h2 className="text-lg font-semibold tracking-tight">About this product</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-fog">{p.description}</p>
            {p.sourceHost && <p className="mt-4 text-[12.5px] text-mist">Catalog data from {p.sourceHost}</p>}
          </section>
        )}
        {p.specs.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold tracking-tight">Specifications</h2>
            <dl className="mt-3 overflow-hidden rounded-2xl border border-line bg-panel">
              {p.specs.map((s, i) => (
                <div key={`${s.label}-${i}`} className="grid grid-cols-[1fr_1.2fr] gap-4 border-b border-line px-4 py-2.5 text-[13.5px] last:border-0">
                  <dt className="text-fog">{s.label}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </main>
  );
}
