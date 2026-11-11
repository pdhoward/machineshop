"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

import { ensure, live } from "@/lib/cradle/live";
import { buildSpec, specData } from "@/lib/cradle/ui";

import { SpecView } from "./spec-view";
import { Why } from "./why";

/**
 * A shopper's request, answered in place (B21): the layout's skeleton at once,
 * the headline as the model writes it, the products the moment the catalog
 * kernel returns them (often before the model has finished writing), then the
 * Why? record. If the answer fails, the store falls back to its classic search.
 */
export function LiveAnswer({ request }: { request: string }) {
  const router = useRouter();
  const l = useMemo(() => live(request), [request]);
  const state = useSyncExternalStore(
    (onChange) => {
      l.listeners.add(onChange);
      ensure(l);
      return () => void l.listeners.delete(onChange);
    },
    () => l.state,
    () => l.state,
  );

  useEffect(() => {
    if (!state.error) return;
    console.error("[cradle] answer:", state.error);
    router.replace(`/?${new URLSearchParams({ q: request, classic: "1" })}`);
  }, [state.error, request, router]);

  const spec = useMemo(() => buildSpec(state.view), [state.view]);
  const data = useMemo(() => specData(state.view.items), [state.view.items]);
  const why = state.trace ? (
    <Why trace={state.trace} marks={state.marks} />
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1.5 text-[12.5px] font-medium text-mist" role="status">
      <LoaderCircle className="size-3.5 animate-spin" /> {state.view.items ? "Finishing…" : state.view.plan.layout ? "Searching…" : "Deciding…"}
    </span>
  );

  return (
    <section className="pt-6" aria-busy={!state.view.done}>
      <SpecView spec={spec} data={data} slots={{ why }} />
    </section>
  );
}
