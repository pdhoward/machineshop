import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Check, ImageOff } from "lucide-react";

import { SetupNotice } from "@/components/setup-notice";
import { catalogConfigured, product } from "@/lib/catalog";
import { sheetFields } from "@/lib/product";

import { PrintSheet } from "./print-sheet";

type Props = { params: Promise<{ id: string }> };

const NOINDEX: Metadata["robots"] = { index: false, follow: false, googleBot: { index: false, follow: false } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!catalogConfigured()) return { robots: NOINDEX };
  const p = await product((await params).id);
  return { title: p ? `${p.name} (product sheet)` : "Product sheet", robots: NOINDEX };
}

/** The site's own address, for the full product link printed on the sheet. */
async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// When printing, show only the sheet: no site header, footer or assistant.
const PRINT_CSS = `@media print { body > :not(main) { display: none !important; } @page { margin: 12mm; } }`;

/** A one-page product sheet that opens the browser's print window, where the shopper picks "Save as PDF". */
export default async function ProductSheetPage({ params }: Props) {
  if (!catalogConfigured()) return <SetupNotice />;
  const p = await product((await params).id);
  if (!p) notFound();
  const s = sheetFields(p, await origin());

  return (
    <main className="mx-auto max-w-3xl px-4 pt-6 sm:px-6 print:max-w-none print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="mb-5 flex items-center justify-between gap-3 print:hidden">
        <p className="text-[13px] text-fog">Pick &ldquo;Save as PDF&rdquo; in the print window to keep this sheet.</p>
        <PrintSheet />
      </div>

      <article className="flex flex-col gap-5 rounded-3xl border border-line bg-panel p-6 text-ink print:break-inside-avoid print:rounded-none print:border-0 print:p-0">
        <header className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
          <span className="font-semibold tracking-tight">Machine Shop</span>
          <span className="text-[12px] text-mist">Product sheet</span>
        </header>

        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6">
          <div className="photo grid aspect-square place-items-center overflow-hidden rounded-2xl border border-line">
            {s.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote catalog images, many hosts
              <img src={s.image} alt={s.name} className="size-full object-contain p-3" />
            ) : (
              <span className="flex flex-col items-center gap-2 text-[12px] text-mist">
                <ImageOff className="size-8" /> No photo
              </span>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {s.brand && <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist">{s.brand}</p>}
            <h1 className="text-xl font-semibold leading-tight tracking-tight">{s.name}</h1>
            <p className="flex flex-wrap items-baseline gap-3">
              <span className="text-2xl font-semibold tabular-nums">{s.price}</span>
              <span className={`text-[13px] font-medium ${s.inStock ? "text-good" : "text-bad"}`}>{s.stock}</span>
            </p>
            {s.highlights.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {s.highlights.map((h) => (
                  <li key={h} className="flex gap-2 text-[13px] leading-snug">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-accent" />
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {s.specs.length > 0 && (
          <section>
            <h2 className="text-[14px] font-semibold">Specifications</h2>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 text-[12px]">
              {s.specs.map((x, i) => (
                <div key={`${x.label}-${i}`} className="grid grid-cols-[1fr_1.2fr] gap-3 border-b border-line py-1.5">
                  <dt className="text-fog">{x.label}</dt>
                  <dd>{x.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <footer className="border-t border-line pt-3 text-[12px] text-fog">
          <a href={s.link} className="break-all text-ink underline">
            {s.link}
          </a>
          <p className="mt-1 text-mist">Machine Shop is a demonstration store: browse and ask, no ordering.</p>
        </footer>
      </article>
    </main>
  );
}
