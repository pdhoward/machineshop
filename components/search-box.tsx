"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

/** Searches the whole catalog; keeps the current department if one is chosen. */
export function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    const c = params.get("c");
    if (c) next.set("c", c);
    router.push(`/${next.size ? `?${next}` : ""}`);
  }

  return (
    <form onSubmit={submit} role="search" className="relative min-w-0 flex-1 sm:max-w-xl">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-mist" />
      <label htmlFor="q" className="sr-only">
        Search products
      </label>
      <input
        id="q"
        name="q"
        key={params.get("q") ?? ""}
        defaultValue={params.get("q") ?? ""}
        placeholder="Search 10,000 products: drill, rug, pendant light…"
        className="w-full rounded-full border border-line bg-panel py-2.5 pl-10 pr-4 text-[14px] text-ink placeholder:text-mist focus:border-accent focus:outline-none"
      />
    </form>
  );
}
