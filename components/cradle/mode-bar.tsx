import { Sparkles } from "lucide-react";

import { cradleConfigured } from "@/lib/cradle/book";
import { compiledRules } from "@/lib/cradle/compile";

/** The strip under the header in cradle mode: this store runs on its policy book, and which version. */
export async function ModeBar() {
  if (!cradleConfigured()) return null;
  const { book, compiled } = await compiledRules();
  return (
    <div className="border-b border-line bg-panel">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-[12px] sm:px-6">
        <span className="flex items-center gap-1.5 font-semibold text-accent">
          <Sparkles className="size-3.5" /> Full transformation
        </span>
        <span className="text-fog">
          This store is run by an app agent on its policy book
          {book ? <> · rules version <span className="font-mono">{book.version}</span> · {book.policies.length} policies, {book.rulings.length} rulings</> : " · the book can't be reached, so it runs on safe settings"}
          {book && !compiled && " · compiling…"}
        </span>
        <span className="ml-auto hidden text-mist sm:inline">Ask in plain words: “a cordless drill under $150 I can buy today”</span>
      </div>
    </div>
  );
}
