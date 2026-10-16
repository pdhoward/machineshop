import Link from "next/link";
import { FileDown, ImageOff, Star } from "lucide-react";

import { money, type ProductCard as Card } from "@/lib/product";

/**
 * One product: photo, name, one-line blurb, price and stock. The whole card is
 * the link. Compact cards (the assistant panel) also get a "Save as PDF"
 * button in the photo corner, beside the link since a link can't hold another
 * control, which opens the printable sheet in a new tab.
 */
export function ProductCard({ p, compact = false }: { p: Card; compact?: boolean }) {
  const card = (
    <Link
      href={`/p/${p.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-panel transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)]"
    >
      <div className="photo relative aspect-square overflow-hidden">
        {p.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote catalog images, many hosts
          <img
            src={p.image}
            alt=""
            loading="lazy"
            className="size-full object-contain p-4 transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="grid size-full place-items-center text-mist">
            <ImageOff className="size-8" />
          </div>
        )}
        {!p.inStock && (
          <span className="absolute left-3 top-3 rounded-full bg-ink/85 px-2 py-0.5 text-[11px] font-medium text-white">Out of stock</span>
        )}
      </div>
      <div className={`flex flex-1 flex-col gap-1.5 ${compact ? "p-3" : "p-4"}`}>
        {(p.brand || p.category) && (
          <span className="truncate font-mono text-[10.5px] uppercase tracking-[0.12em] text-mist">{p.brand ?? p.category}</span>
        )}
        <h3 className={`line-clamp-2 font-medium leading-snug ${compact ? "text-[13px]" : "text-[14.5px]"}`}>{p.name}</h3>
        {!compact && <p className="line-clamp-2 text-[13px] leading-relaxed text-fog">{p.blurb}</p>}
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <span className={`font-semibold tabular-nums ${compact ? "text-[14px]" : "text-[17px]"}`}>{money(p.price, p.currency)}</span>
          {p.rating && (
            <span className="flex items-center gap-1 text-[12px] text-fog">
              <Star className="size-3.5 fill-accent text-accent" />
              {p.rating.toFixed(1)}
              {p.reviews && <span className="text-mist">({p.reviews})</span>}
            </span>
          )}
        </div>
      </div>
    </Link>
  );

  if (!compact) return card;

  return (
    <div className="relative h-full">
      {card}
      <a
        href={`/p/${p.id}/sheet`}
        target="_blank"
        rel="noopener"
        aria-label={`Save ${p.name} as PDF`}
        title="Save as PDF"
        className="absolute right-2 top-2 grid size-7 place-items-center rounded-full border border-line bg-panel text-fog shadow-sm hover:border-accent hover:text-accent"
      >
        <FileDown className="size-3.5" />
      </a>
    </div>
  );
}
