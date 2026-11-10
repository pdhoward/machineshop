"use client";

import { useState } from "react";
import { ScrollText, X } from "lucide-react";

import type { Trace } from "@/lib/cradle/agent";

/**
 * Why? — the record of one decision (cradle mode): the steps the app agent
 * took, how long each took, what the model call cost, the book version, and
 * the rules that shaped the answer. Made for comparing the three versions.
 */
export function Why({ trace }: { trace: Trace }) {
  const [open, setOpen] = useState(false);
  const total = trace.costUsd + (trace.compile?.costUsd ?? 0);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1.5 text-[12.5px] font-medium text-fog transition-colors hover:border-accent hover:text-accent"
      >
        <ScrollText className="size-3.5" /> Why? · {(trace.totalMs / 1000).toFixed(1)}s · ${total.toFixed(4)}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setOpen(false)}>
          <aside className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()} aria-label="Why these results">
            <div className="flex items-center gap-2">
              <ScrollText className="size-4 text-accent" />
              <h2 className="text-[16px] font-semibold">Why these results</h2>
              <button type="button" onClick={() => setOpen(false)} className="ml-auto grid size-8 place-items-center rounded-full text-mist hover:bg-panel-2 hover:text-ink" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-1 text-[12.5px] text-mist">
              Decision {trace.id} · rules version {trace.bookVersion ?? "none"}{trace.compiled ? "" : " (safe settings)"}
            </p>

            <h3 className="mt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-mist">The request path</h3>
            <ol className="mt-2 flex flex-col gap-1.5">
              {trace.stages.map((s) => (
                <li key={s.name} className="rounded-xl border border-line bg-panel px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13.5px] font-semibold capitalize">{s.name}</span>
                    <span className="ml-auto font-mono text-[11.5px] tabular-nums text-mist">{s.ms} ms</span>
                  </div>
                  <p className="text-[12.5px] leading-snug text-fog">{s.detail}</p>
                </li>
              ))}
            </ol>

            <dl className="mt-4 grid grid-cols-2 gap-2 text-[12.5px]">
              {[
                ["Total", `${trace.totalMs} ms`],
                ["Model", trace.model ?? "none"],
                ["Tokens", `${trace.tokensIn.toLocaleString()} in · ${trace.tokensOut.toLocaleString()} out`],
                ["Model cost", `$${trace.costUsd.toFixed(5)}`],
                ...(trace.compile
                  ? [
                      ["Rule compile", `$${trace.compile.costUsd.toFixed(4)} · ${(trace.compile.ms / 1000).toFixed(1)} s`],
                      ["Compile model", trace.compile.model],
                    ]
                  : []),
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-line px-3 py-2">
                  <dt className="text-mist">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>

            <h3 className="mt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-mist">Rules that shaped this</h3>
            {trace.rules.length ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {trace.rules.map((r) => (
                  <li key={r.key} className="rounded-xl border border-line px-3 py-2 text-[12.5px] leading-snug">
                    <span className="font-mono text-[11px] text-accent">{r.key}</span>
                    <p className="mt-0.5 text-fog">{r.text}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[12.5px] text-mist">No specific rule applied.</p>
            )}
            <p className="mt-5 text-[11.5px] leading-relaxed text-mist">
              {trace.compile && (
                <>
                  This request compiled the rules into the store&apos;s settings first, which happens once per rules version on each server, so it paid for and waited on that. Later requests reuse it.{" "}
                </>
              )}
              These rules live in the store&apos;s policy book on the Accelerator. When the owner changes one, this store follows it within seconds. No code changes, no release.
            </p>
          </aside>
        </div>
      )}
    </>
  );
}
