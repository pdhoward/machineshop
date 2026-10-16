import Link from "next/link";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, SearchX } from "lucide-react";

import { AskButton } from "@/components/assistant";
import { ProductCard } from "@/components/product-card";
import { SetupNotice } from "@/components/setup-notice";
import { catalogConfigured, listDepartments, PAGE_SIZE, search } from "@/lib/catalog";

type Params = { q?: string; c?: string; page?: string };

const href = (p: Params) => {
  const s = new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1]));
  return `/${s.size ? `?${s}` : ""}`;
};

export default async function Home({ searchParams }: { searchParams: Promise<Params> }) {
  const { q, c, page: pageParam } = await searchParams;
  if (!catalogConfigured()) return <SetupNotice />;

  const page = Math.max(1, Number(pageParam) || 1);
  const [{ items, total }, departments] = await Promise.all([search({ q, category: c }, page), listDepartments()]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const browsing = !q && !c;

  return (
    <main className="mx-auto max-w-7xl px-4 sm:px-6">
      {browsing && page === 1 && (
        <section className="py-10 sm:py-14">
          <div className="max-w-2xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">{total.toLocaleString()} products · home & workshop</p>
            <h1 className="mt-3 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
              Everything for the build.
              <br />
              <span className="text-fog">Ask for anything.</span>
            </h1>
          </div>
        </section>
      )}

      <nav aria-label="Departments" className={clsx("-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6", browsing && page === 1 ? "" : "pt-6")}>
        <Chip href={href({ q })} active={!c}>
          All
        </Chip>
        {departments.map((d) => (
          <Chip key={d.name} href={href({ q, c: d.name })} active={c === d.name}>
            {d.name} <span className="text-mist">{d.count.toLocaleString()}</span>
          </Chip>
        ))}
      </nav>

      {!browsing && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-6">
          <h1 className="text-2xl font-semibold tracking-tight">{q ? `“${q}”` : c}</h1>
          <span className="text-[14px] text-fog">
            {total.toLocaleString()} {total === 1 ? "product" : "products"}
            {q && c && <> in {c}</>}
          </span>
        </div>
      )}

      {items.length ? (
        <div className="grid grid-cols-2 gap-3 pt-6 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {items.map((p) => (
            <ProductCard key={p.id} p={p} />
          ))}
        </div>
      ) : (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
          <SearchX className="size-8 text-mist" />
          <p className="text-fog">Nothing matches that. Try fewer words, or ask the assistant to find it for you.</p>
          <AskButton prompt={`Help me find: ${q ?? c ?? ""}`} label="Ask the assistant" />
        </div>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-center gap-3 pt-10 text-[14px]">
          <PageLink disabled={page <= 1} href={href({ q, c, page: String(page - 1) })} label="Previous page">
            <ChevronLeft className="size-4" />
          </PageLink>
          <span className="tabular-nums text-fog">
            Page {page} of {pages.toLocaleString()}
          </span>
          <PageLink disabled={page >= pages} href={href({ q, c, page: String(page + 1) })} label="Next page">
            <ChevronRight className="size-4" />
          </PageLink>
        </nav>
      )}
    </main>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] transition-colors",
        active ? "border-ink bg-ink text-bg [&_span]:text-bg/60" : "border-line bg-panel text-ink hover:border-fog",
      )}
    >
      {children}
    </Link>
  );
}

function PageLink({ href, disabled, label, children }: { href: string; disabled: boolean; label: string; children: React.ReactNode }) {
  const cls = "grid size-10 place-items-center rounded-full border border-line bg-panel";
  return disabled ? (
    <span className={clsx(cls, "opacity-40")} aria-hidden>
      {children}
    </span>
  ) : (
    <Link href={href} aria-label={label} className={clsx(cls, "hover:border-accent hover:text-accent")}>
      {children}
    </Link>
  );
}
