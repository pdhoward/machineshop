import type { AnswerEvent, Trace } from "./agent";
import type { View } from "./ui";

/**
 * The browser's side of a streamed answer (B21). The search box starts the
 * request on submit, before the page has even navigated, and the answer page
 * picks up the same stream, so no time is lost to the page load. React
 * StrictMode's double mount and a Back to the same results reuse it too: one
 * request, one model call.
 */

/** When each part reached the screen, in ms from the submit. */
export type Marks = { plan?: number; layout?: number; products?: number; done?: number };
export type LiveState = { view: View; trace?: Trace; error?: string; marks: Marks };

export const initial = (request: string): LiveState => ({ view: { request, plan: {}, done: false }, marks: {} });

/** Apply one event (pure, so it is tested without a browser). `ms` is the time since the submit. */
export function reduce(s: LiveState, e: AnswerEvent, ms: number): LiveState {
  const marks = { ...s.marks };
  switch (e.type) {
    case "plan":
      marks.plan ??= ms;
      if (e.plan.layout) marks.layout ??= ms;
      return { ...s, view: { ...s.view, plan: e.plan }, marks };
    case "items":
      if (e.items.length) marks.products ??= ms;
      return { ...s, view: { ...s.view, items: e.items, total: e.total, searched: e.searched, hideOutOfStock: e.hideOutOfStock }, marks };
    case "done":
      marks.done = ms;
      return { ...s, view: { ...s.view, plan: e.plan, total: e.total, items: s.view.items ?? [], done: true }, trace: e.trace, marks };
    case "error":
      return { ...s, error: e.message, marks };
  }
}

type Live = { state: LiveState; listeners: Set<() => void>; started: boolean; t0: number; at: number };
const lives = new Map<string, Live>();
const KEEP = 8;
const FRESH_MS = 2 * 60_000;

const make = (request: string): Live => ({ state: initial(request), listeners: new Set(), started: false, t0: 0, at: Date.now() });

/** The answer for this request: the one in flight or recently finished, else a new one (not started). */
export function live(request: string): Live {
  if (typeof window === "undefined") return make(request); // server render: never share across shoppers
  let l = lives.get(request);
  if (!l) {
    l = make(request);
    lives.set(request, l);
    while (lives.size > KEEP) lives.delete(lives.keys().next().value!);
  }
  return l;
}

/** The shopper asked (submit, or a follow-up click): start now. A failed or stale answer is asked again. */
export function startAnswer(request: string): Live {
  const old = lives.get(request);
  if (old && (old.state.error || (old.state.view.done && Date.now() - old.at > FRESH_MS))) lives.delete(request);
  const l = live(request);
  ensure(l);
  return l;
}

/** Start the request if nobody has yet. */
export function ensure(l: Live) {
  if (l.started || typeof window === "undefined") return;
  l.started = true;
  l.t0 = performance.now();
  void run(l);
}

function set(l: Live, next: LiveState) {
  l.state = next;
  l.at = Date.now();
  for (const f of l.listeners) f();
}

async function run(l: Live) {
  const ms = () => Math.round(performance.now() - l.t0);
  try {
    const res = await fetch("/api/cradle/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: l.state.view.request }),
    });
    if (!res.ok || !res.body) throw new Error(`the store answered ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) set(l, reduce(l.state, JSON.parse(line) as AnswerEvent, ms()));
      }
    }
    if (!l.state.view.done && !l.state.error) set(l, { ...l.state, error: "The answer stopped early." });
  } catch (err) {
    set(l, { ...l.state, error: err instanceof Error ? err.message : "The store couldn't answer." });
  }
}
