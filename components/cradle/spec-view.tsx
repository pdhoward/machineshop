"use client";

import Link from "next/link";
import { Ban, ShoppingBag, Sparkles } from "lucide-react";

import { ProductCard } from "@/components/product-card";
import type { Item } from "@/lib/cradle/agent";
import { startAnswer } from "@/lib/cradle/live";
import type { ComponentType, PropsOf, Spec, SpecData } from "@/lib/cradle/ui";
import { money } from "@/lib/product";

/**
 * The web store's renderer for the component catalog (lib/cradle/ui.ts, B8).
 * One tested component per catalog entry; the types make a missing one a
 * compile error. Elements keep their ids as React keys, so as the spec is
 * patched (skeleton, then fields, then products) each part updates in place.
 * Kernel-bound components read price, stock and the buy decision from the
 * kernel's data, never from the spec.
 */

type Slots = { why?: React.ReactNode };
type Render<K extends ComponentType> = (x: { props: PropsOf[K]; children: React.ReactNode; data: SpecData; slots: Slots }) => React.ReactNode;

const REGISTRY: { [K in ComponentType]: Render<K> } = {
  Answer: ({ children }) => <>{children}</>,

  Heading: ({ props, slots }) => (
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
          <Sparkles className="size-3.5" /> You asked: {props.request}
        </p>
        {props.headline ? (
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">{props.headline}</h1>
        ) : (
          <div className="mt-2.5 h-6 w-2/3 max-w-md animate-pulse rounded-md bg-panel-2" aria-hidden />
        )}
        {props.explanation ? (
          <p className="mt-1 max-w-3xl text-[14px] leading-relaxed text-fog">{props.explanation}</p>
        ) : (
          <div className="mt-2 h-4 w-full max-w-2xl animate-pulse rounded bg-panel-2" aria-hidden />
        )}
      </div>
      {slots.why}
    </div>
  ),

  Filters: ({ props }) => (
    <>
      {props.note && (
        <p className="mt-3 rounded-xl border border-line bg-panel px-3 py-2 text-[13px] leading-snug text-fog" role="note">
          {props.note}
        </p>
      )}
      <div className="mt-3 flex min-h-6 flex-wrap items-center gap-1.5 text-[12.5px]">
      {props.chips.map((f) => (
        <span key={f} className="rounded-full border border-line bg-panel px-2.5 py-0.5 text-fog">{f}</span>
      ))}
      {props.total != null && (
        <span className="text-mist">
          · {props.shown != null && `${props.shown} of `}
          {props.total.toLocaleString()} {props.total === 1 ? "match" : "matches"}
        </span>
      )}
      {props.more && props.classicHref && (
        <Link href={props.classicHref} className="text-mist underline-offset-2 hover:text-ink hover:underline">
          see all in the classic list
        </Link>
      )}
      </div>
    </>
  ),

  Products: ({ props, data }) => (
    <div className={`grid gap-3 pt-5 sm:gap-4 ${props.layout === "single" ? "max-w-sm" : "grid-cols-2 md:grid-cols-3 lg:grid-cols-4"}`}>
      {props.ids.map((id) => data.products[id]).filter(Boolean).map((p) => (
        <div key={p!.id} className="flex flex-col gap-1.5">
          <ProductCard p={p!} />
          <BuyBadge p={p!} />
        </div>
      ))}
    </div>
  ),

  Compare: ({ props, data }) => <Compare items={props.ids.map((id) => data.products[id]).filter((p): p is Item => !!p)} />,

  Skeleton: ({ props }) =>
    props.layout === "compare" ? (
      <div className="mt-5 h-64 animate-pulse rounded-2xl border border-line bg-panel" aria-label="Loading the comparison" />
    ) : (
      <div className={`grid gap-3 pt-5 sm:gap-4 ${props.layout === "single" ? "max-w-sm" : "grid-cols-2 md:grid-cols-3 lg:grid-cols-4"}`} aria-label="Loading products">
        {Array.from({ length: props.count }, (_, i) => (
          <div key={i} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-panel">
            <div className="aspect-square animate-pulse bg-panel-2" />
            <div className="flex flex-col gap-2 p-4">
              <div className="h-3 w-1/3 animate-pulse rounded bg-panel-2" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-panel-2" />
              <div className="h-4 w-1/4 animate-pulse rounded bg-panel-2" />
            </div>
          </div>
        ))}
      </div>
    ),

  Empty: ({ props }) => <p className="py-16 text-center text-fog">{props.message}</p>,

  FollowUp: ({ props }) => (
    <p className="mt-6 text-[13.5px] text-fog">
      Next, try:{" "}
      <Link
        href={`/?${new URLSearchParams({ q: props.text })}`}
        onClick={() => startAnswer(props.text)}
        className="font-medium text-accent hover:underline"
      >
        {props.text}
      </Link>
    </p>
  ),
};

export function SpecView({ spec, data, slots = {} }: { spec: Spec; data: SpecData; slots?: Slots }) {
  const render = (id: string): React.ReactNode => {
    const e = spec.elements[id];
    if (!e) return null;
    const children = e.children.map((c) => <Slot key={c}>{render(c)}</Slot>);
    return (REGISTRY[e.type] as Render<ComponentType>)({ props: e.props, children, data, slots });
  };
  return <>{render(spec.root)}</>;
}

const Slot = ({ children }: { children: React.ReactNode }) => <>{children}</>;

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
