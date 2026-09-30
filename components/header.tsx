import { Suspense } from "react";
import Link from "next/link";
import { Cog } from "lucide-react";

import { SearchBox } from "./search-box";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Machine Shop home">
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-on-accent">
            <Cog className="size-5" strokeWidth={2.25} />
          </span>
          <span className="hidden text-[17px] font-semibold tracking-tight sm:block">
            Machine <span className="text-accent">Shop</span>
          </span>
        </Link>
        <Suspense fallback={<div className="h-[42px] min-w-0 flex-1 rounded-full border border-line bg-panel sm:max-w-xl" />}>
          <SearchBox />
        </Suspense>
      </div>
    </header>
  );
}
