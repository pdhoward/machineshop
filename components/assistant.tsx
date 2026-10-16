"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, MessageCircle, Phone, Sparkles, X } from "lucide-react";

import type { ProductCard as Card } from "@/lib/product";

import { ProductCard } from "./product-card";
import { VoiceCall, type VoiceCallHandle } from "./voice-call";

/**
 * The shop assistant: a floating dock and a chat panel. The dock offers Text
 * (opens the chat, ready to type) and, with `voice`, Talk (opens the panel
 * straight to the call's code prompt). Any page can open it with a question
 * via <AskButton> (a window event, so no shared state). The panel also offers
 * Talk (<VoiceCall>); during a call, typed text goes into the live call
 * instead of typed chat.
 */
type Turn = { role: "user" | "assistant"; content: string; products?: Card[] };

const ASK = "machineshop:ask";
const DOCK =
  "flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4 text-[14px] font-semibold shadow-[0_12px_32px_-12px_rgba(0,0,0,0.45)] ring-1 ring-black/5 transition-[transform,background-color,opacity] duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const STARTERS = ["A gift under $50 for someone who loves to cook", "Brightest outdoor lights for a patio", "A sturdy cordless drill for a beginner"];

export function AskButton({ prompt, label }: { prompt: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(ASK, { detail: prompt }))}
      className="inline-flex items-center gap-2 self-start rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-on-accent transition-colors hover:bg-accent-2"
    >
      <Sparkles className="size-4" /> {label}
    </button>
  );
}

export function Assistant({ enabled, voice = false }: { enabled: boolean; voice?: boolean }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceLive, setVoiceLive] = useState(false);
  // How the dock opened the panel: straight to a call, or to the text box.
  const [opening, setOpening] = useState<"talk" | "text" | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const call = useRef<VoiceCallHandle>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  async function ask(text: string) {
    const q = text.trim();
    if (!q) return;
    if (call.current?.send(q)) {
      setDraft("");
      return;
    }
    if (busy) return;
    const next: Turn[] = [...turnsRef.current, { role: "user", content: q }];
    setTurns(next);
    setDraft("");
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const data = (await res.json()) as { reply?: string; products?: Card[]; error?: string };
      if (!res.ok || !data.reply) throw new Error(data.error ?? "Something went wrong.");
      setTurns([...next, { role: "assistant", content: data.reply, products: data.products }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  // Pages ask questions through <AskButton>.
  useEffect(() => {
    const onAsk = (e: Event) => {
      setOpen(true);
      if (enabled) void ask((e as CustomEvent<string>).detail);
    };
    window.addEventListener(ASK, onAsk);
    return () => window.removeEventListener(ASK, onAsk);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ask reads the latest turns via a ref
  }, [enabled]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  useEffect(() => {
    if (open && opening === "text") input.current?.focus();
  }, [open, opening]);

  function openAs(how: "talk" | "text") {
    setOpening(how);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setOpening(null);
  }

  return (
    <>
      {!open && (
        <nav aria-label="Shop assistant" className="rise-in fixed bottom-5 right-4 z-40 flex flex-col items-end gap-2 sm:right-5">
          {voice && (
            <button type="button" onClick={() => openAs("talk")} className={`${DOCK} bg-accent text-on-accent hover:bg-accent-2`}>
              <span className="relative grid size-8 place-items-center rounded-full bg-white/20">
                <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-white/25 [animation-duration:2.4s] motion-reduce:hidden" />
                <Phone className="relative size-4" fill="currentColor" strokeWidth={1.5} />
              </span>
              Talk with the Shop Assistant
            </button>
          )}
          <button type="button" onClick={() => openAs("text")} className={`${DOCK} bg-ink text-bg hover:opacity-90`}>
            <span className="grid size-8 place-items-center rounded-full bg-bg/15">
              <MessageCircle className="size-4" />
            </span>
            Text with the Shop Assistant
          </button>
        </nav>
      )}

      {open && (
        <section
          aria-label="Shop assistant"
          className="rise-in fixed inset-x-3 bottom-3 z-40 flex max-h-[86vh] flex-col overflow-hidden rounded-3xl border border-line bg-panel shadow-2xl sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[420px]"
        >
          <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
            <span className="grid size-8 place-items-center rounded-full bg-accent/15 text-accent">
              <Sparkles className="size-4" />
            </span>
            <div className="flex-1 leading-tight">
              <p className="font-semibold">Shop assistant</p>
              <p className="text-[12px] text-mist">Knows every product in the store</p>
            </div>
            <button type="button" onClick={close} className="rounded-full p-1.5 text-mist hover:bg-panel-2 hover:text-ink" aria-label="Close assistant">
              <X className="size-4" />
            </button>
          </header>

          {voice && <VoiceCall ref={call} talkOnOpen={opening === "talk"} onLiveChange={setVoiceLive} onMicProblem={() => input.current?.focus()} />}

          {/* During a call with no typed chat yet, the call's cards get the room instead of the starters. */}
          <div ref={scroller} className={`${voiceLive && turns.length === 0 ? "hidden" : "flex"} min-h-[220px] flex-1 flex-col gap-4 overflow-y-auto px-4 py-4`}>
            {!enabled ? (
              <p className="text-[14px] text-fog">The assistant isn&apos;t switched on for this store yet (it needs an ANTHROPIC_API_KEY).</p>
            ) : turns.length === 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-[14px] text-fog">Tell me what you&apos;re working on and I&apos;ll find the right things. For example:</p>
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="rounded-2xl border border-line px-3.5 py-2.5 text-left text-[13.5px] hover:border-accent hover:text-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              turns.map((t, i) =>
                t.role === "user" ? (
                  <p key={i} className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-[14px] text-bg">
                    {t.content}
                  </p>
                ) : (
                  <div key={i} className="flex flex-col gap-3">
                    <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{t.content}</p>
                    {!!t.products?.length && (
                      <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1">
                        {t.products.map((p) => (
                          <div key={p.id} className="w-[150px] shrink-0">
                            <ProductCard p={p} compact />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ),
              )
            )}
            {busy && (
              <p className="flex items-center gap-2 text-[13px] text-mist">
                <Loader2 className="size-4 animate-spin" /> Looking through the shelves…
              </p>
            )}
            {error && <p className="text-[13px] text-bad">{error}</p>}
          </div>

          {(enabled || voiceLive) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void ask(draft);
              }}
              className="flex items-end gap-2 border-t border-line p-3"
            >
              <label htmlFor="assistant-input" className="sr-only">
                Ask the assistant
              </label>
              <textarea
                id="assistant-input"
                ref={input}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask(draft);
                  }
                }}
                rows={1}
                maxLength={2000}
                placeholder={voiceLive ? "Type into the call…" : "Ask about any product…"}
                className="max-h-32 min-h-[42px] flex-1 resize-none rounded-2xl border border-line bg-bg px-3.5 py-2.5 text-[14px] placeholder:text-mist focus:border-accent focus:outline-none"
              />
              <button
                type="submit"
                disabled={(busy && !voiceLive) || !draft.trim()}
                aria-label="Send"
                className="grid size-[42px] shrink-0 place-items-center rounded-full bg-accent text-on-accent transition-colors hover:bg-accent-2 disabled:opacity-40"
              >
                <ArrowUp className="size-4" />
              </button>
            </form>
          )}
        </section>
      )}
    </>
  );
}
