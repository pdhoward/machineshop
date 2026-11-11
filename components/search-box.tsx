"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import { startAnswer } from "@/lib/cradle/live";

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
    // Cradle mode: start the answer now, while the page navigates (B21); the answer page picks up the same stream.
    if (q && process.env.NEXT_PUBLIC_CRADLE_MODE) startAnswer(q);
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
        placeholder={process.env.NEXT_PUBLIC_CRADLE_MODE ? "Ask for anything: a cordless drill under $150 I can buy today…" : "Search 10,000 products: drill, rug, pendant light…"}
        className="w-full rounded-full border border-line bg-panel py-2.5 pl-10 pr-4 text-[14px] text-ink placeholder:text-mist focus:border-accent focus:outline-none"
      />
    </form>
  );
}
