"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, MessageCircle, Phone, Sparkles, X } from "lucide-react";

import type { ProductCard as Card } from "@/lib/product";

import { ProductCard } from "./product-card";
import { VoiceCall, type VoiceCallHandle } from "./voice-call";

/**
 * The shop assistant: one floating button that pops up a choice of Talk
 * (phone) or Text (chat). Talk opens a voice-only widget straight to the
 * call's code prompt (<VoiceCall>); its chat icon slides out a text box, and
 * during a call typed text goes into the live call. Text opens the typed chat,
 * with a phone icon to switch to Talk. Any page can open the chat with a
 * question via <AskButton> (a window event, so no shared state).
 */
type Turn = { role: "user" | "assistant"; content: string; products?: Card[] };
type Mode = "talk" | "text";

const ASK = "machineshop:ask";
const STARTERS = ["A gift under $50 for someone who loves to cook", "Brightest outdoor lights for a patio", "A sturdy cordless drill for a beginner"];
const ICON_BUTTON = "grid size-8 place-items-center rounded-full text-mist transition-colors hover:bg-panel-2 hover:text-ink";

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
  const [mode, setMode] = useState<Mode | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Talk mode's optional text box.
  const [typing, setTyping] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceLive, setVoiceLive] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const call = useRef<VoiceCallHandle>(null);
  const launcher = useRef<HTMLDivElement>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  const talk = mode === "talk";
  const showInput = (enabled || voiceLive) && (mode === "text" || typing);
  const showChat = mode === "text" || (typing && (turns.length > 0 || busy || !!error));

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

  function openAs(m: Mode) {
    setMenuOpen(false);
    setTyping(false);
    setMode(m);
  }

  function close() {
    setMode(null);
    setTyping(false);
  }

  // Pages ask questions through <AskButton>: in the chat, or into a live call.
  useEffect(() => {
    const onAsk = (e: Event) => {
      setMenuOpen(false);
      setMode((m) => (m === "talk" ? m : "text"));
      setTyping(true);
      if (enabled) void ask((e as CustomEvent<string>).detail);
    };
    window.addEventListener(ASK, onAsk);
    return () => window.removeEventListener(ASK, onAsk);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ask reads the latest turns via a ref
  }, [enabled]);

  // The launcher's menu closes on a click elsewhere or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!launcher.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  useEffect(() => {
    if (showInput) input.current?.focus();
  }, [showInput, mode]);

  return (
    <>
      {!mode && (
        <div ref={launcher} className="fixed bottom-5 right-4 z-40 flex flex-col items-end gap-3 sm:right-5">
          {menuOpen && (
            <div role="menu" aria-label="Contact the shop assistant" className="rise-in flex flex-col items-end gap-2.5">
              {voice && (
                <LauncherOption label="Talk live" hint="5-minute voice call" onClick={() => openAs("talk")} className="bg-call text-white hover:bg-call-2">
                  <Phone className="size-5" fill="currentColor" strokeWidth={1.5} />
                </LauncherOption>
              )}
              <LauncherOption label="Text chat" hint="Type your questions" onClick={() => openAs("text")} className="bg-ink text-bg hover:opacity-90">
                <MessageCircle className="size-5" />
              </LauncherOption>
            </div>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? "Close the menu" : "Shop assistant"}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Shop assistant"
            className="rise-in relative grid size-14 place-items-center rounded-full bg-accent text-on-accent shadow-[0_14px_34px_-12px_rgba(0,0,0,0.5)] ring-1 ring-black/5 transition-[transform,background-color] duration-200 hover:scale-105 hover:bg-accent-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {!menuOpen && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-accent/30 [animation-duration:2.6s] motion-reduce:hidden" />}
            {menuOpen ? <X className="relative size-6" /> : <Sparkles className="relative size-6" />}
          </button>
        </div>
      )}

      {mode && (
        <section
          aria-label={talk ? "Talk with the shop assistant" : "Text with the shop assistant"}
          className="rise-in fixed inset-x-3 bottom-3 z-40 flex max-h-[86vh] flex-col overflow-hidden rounded-3xl border border-line bg-panel shadow-2xl sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[420px]"
        >
          <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
            <span className={`grid size-8 place-items-center rounded-full ${talk ? "bg-call/15 text-call" : "bg-accent/15 text-accent"}`}>
              {talk ? <Phone className="size-4" fill="currentColor" strokeWidth={1.5} /> : <MessageCircle className="size-4" />}
            </span>
            <div className="flex-1 leading-tight">
              <p className="font-semibold">Shop assistant</p>
              <p className="text-[12px] text-mist">{talk ? "Live voice" : "Knows every product in the store"}</p>
            </div>
            {talk && (enabled || voiceLive) && (
              <button
                type="button"
                onClick={() => setTyping((t) => !t)}
                aria-label={typing ? "Hide the text box" : "Type instead"}
                aria-pressed={typing}
                title={typing ? "Hide the text box" : "Type instead"}
                className={`${ICON_BUTTON} ${typing ? "bg-panel-2 text-ink" : ""}`}
              >
                <MessageCircle className="size-4" />
              </button>
            )}
            {!talk && voice && (
              <button type="button" onClick={() => openAs("talk")} aria-label="Switch to a voice call" title="Talk live" className={`${ICON_BUTTON} hover:text-call`}>
                <Phone className="size-4" />
              </button>
            )}
            <button type="button" onClick={close} className={ICON_BUTTON} aria-label="Close assistant">
              <X className="size-4" />
            </button>
          </header>

          {/* Mounted only in Talk mode; closing the widget or switching away hangs up. */}
          {talk && voice && (
            <VoiceCall
              ref={call}
              talkOnOpen
              onLiveChange={setVoiceLive}
              onMicProblem={() => {
                setTyping(true);
                input.current?.focus();
              }}
            />
          )}

          {showChat && (
            <div ref={scroller} className={`flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 ${talk ? "min-h-0" : "min-h-[220px]"}`}>
              {!enabled && !talk ? (
                <p className="text-[14px] text-fog">The assistant isn&apos;t switched on for this store yet (it needs an ANTHROPIC_API_KEY).</p>
              ) : turns.length === 0 && !talk ? (
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
          )}

          {showInput && (
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

function LauncherOption({ label, hint, onClick, className, children }: { label: string; hint: string; onClick: () => void; className: string; children: React.ReactNode }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="group flex items-center gap-3 focus-visible:outline-none">
      <span className="rounded-2xl border border-line bg-panel px-3 py-1.5 text-right leading-tight shadow-md">
        <span className="block text-[13.5px] font-semibold">{label}</span>
        <span className="block text-[11.5px] text-mist">{hint}</span>
      </span>
      <span
        className={`grid size-12 place-items-center rounded-full shadow-[0_10px_26px_-10px_rgba(0,0,0,0.5)] transition-transform duration-200 group-hover:scale-105 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent ${className}`}
      >
        {children}
      </span>
    </button>
  );
}
