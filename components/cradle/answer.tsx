import Link from "next/link";
import { Ban, ShoppingBag, Sparkles } from "lucide-react";

import { ProductCard } from "@/components/product-card";
import type { Answer, Item } from "@/lib/cradle/agent";
import { money } from "@/lib/product";

import { Why } from "./why";

/**
 * What the app agent decided, rendered from tested components only (§1.5):
 * the agent picks the layout and writes the words; prices, stock and the
 * buy decision come from the catalog kernel and the compiled rules.
 */
export function CradleAnswer({ a, request }: { a: Answer; request: string }) {
  const { plan, items, total, trace } = a;
  const filters = [
    plan.query && `“${plan.query}”`,
    plan.category,
    plan.minPrice > 0 && `from ${money(plan.minPrice)}`,
    plan.maxPrice > 0 && `up to ${money(plan.maxPrice)}`,
    (plan.inStockOnly || a.projection.search.hideOutOfStockByDefault) && "in stock",
  ].filter(Boolean) as string[];
  const classic = new URLSearchParams({ q: plan.query, ...(plan.category ? { c: plan.category } : {}), classic: "1" });

  return (
    <section className="pt-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
            <Sparkles className="size-3.5" /> You asked: {request}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">{plan.headline}</h1>
          <p className="mt-1 max-w-3xl text-[14px] leading-relaxed text-fog">{plan.explanation}</p>
        </div>
        <Why trace={trace} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12.5px]">
        {filters.map((f) => (
          <span key={f} className="rounded-full border border-line bg-panel px-2.5 py-0.5 text-fog">{f}</span>
        ))}
        <span className="text-mist">· {total.toLocaleString()} {total === 1 ? "match" : "matches"}</span>
        {total > items.length && (
          <Link href={`/?${classic}`} className="text-mist underline-offset-2 hover:text-ink hover:underline">
            see all in the classic list
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <p className="py-16 text-center text-fog">Nothing in the catalog matches that under the store&apos;s rules. Try different words.</p>
      ) : plan.layout === "compare" ? (
        <Compare items={items} />
      ) : (
        <div className={`grid gap-3 pt-5 sm:gap-4 ${plan.layout === "single" ? "max-w-sm" : "grid-cols-2 md:grid-cols-3 lg:grid-cols-4"}`}>
          {items.map((p) => (
            <div key={p.id} className="flex flex-col gap-1.5">
              <ProductCard p={p} />
              <BuyBadge p={p} />
            </div>
          ))}
        </div>
      )}

      {plan.followUp && (
        <p className="mt-6 text-[13.5px] text-fog">
          Next, try:{" "}
          <Link href={`/?${new URLSearchParams({ q: plan.followUp })}`} className="font-medium text-accent hover:underline">
            {plan.followUp}
          </Link>
        </p>
      )}
    </section>
  );
}

function BuyBadge({ p }: { p: Item }) {
  return p.buy.ok ? (
    <span className="flex items-center gap-1.5 px-1 text-[12px] font-medium text-good">
      <ShoppingBag className="size-3.5" /> Can buy now
    </span>
  ) : (
    <span className="flex items-start gap-1.5 px-1 text-[12px] text-mist">
      <Ban className="mt-0.5 size-3.5 shrink-0" /> {p.buy.reason}
    </span>
  );
}

function Compare({ items }: { items: Item[] }) {
  const rows: [string, (p: Item) => React.ReactNode][] = [
    ["Price", (p) => <span className="font-semibold tabular-nums">{money(p.price, p.currency)}</span>],
    ["Brand", (p) => p.brand ?? "—"],
    ["Rating", (p) => (p.rating ? `${p.rating.toFixed(1)}${p.reviews ? ` (${p.reviews})` : ""}` : "—")],
    ["Stock", (p) => (p.stock === "in" ? "In stock" : p.stock === "out" ? "Out of stock" : "Unclear")],
    ["Buy", (p) => <BuyBadge p={p} />],
  ];
  return (
    <div className="mt-5 overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[640px] text-left text-[13.5px]">
        <thead>
          <tr className="border-b border-line bg-panel">
            <th className="w-28 px-4 py-3" />
            {items.map((p) => (
              <th key={p.id} className="px-4 py-3 align-top font-medium">
                <Link href={`/p/${p.id}`} className="line-clamp-3 hover:text-accent">{p.name}</Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, cell]) => (
            <tr key={label} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5 text-fog">{label}</td>
              {items.map((p) => (
                <td key={p.id} className="px-4 py-2.5">{cell(p)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
