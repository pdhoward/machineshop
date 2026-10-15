"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, FileText, Loader2, LogOut } from "lucide-react";

import { formatAvailableAt, OWNER_SPEAKER_LABELS, type StoredLine } from "@/lib/voice";

import { TranscriptModal } from "./transcript-modal";

/**
 * The owner's saved-calls list. Asks for the owner code when the list says
 * it's signed out (the cookie is httpOnly, so only the server knows), shows
 * 20 calls a page from the last 30 days, and opens each in the same
 * transcript window the Talk panel uses.
 */

type Item = { sessionId: string; createdAt: string };
type ListPage = { items: Item[]; total: number; page: number; pages: number };
type OpenCall = { title: string; lines: StoredLine[] };

const formatCallTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function OwnerTranscripts() {
  const [state, setState] = useState<"loading" | "signed_out" | "list">("loading");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<ListPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [call, setCall] = useState<OpenCall | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async (n: number) => {
    setError(null);
    try {
      const res = await fetch(`/api/voice/owner/transcripts?page=${n}`, { cache: "no-store" });
      if (res.status === 401) return setState("signed_out");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      setList(data);
      setState("list");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't load the saved calls.");
      setState((s) => (s === "loading" ? "signed_out" : s));
    }
  }, []);

  useEffect(() => {
    load(page);
  }, [load, page]);

  useEffect(() => {
    if (state === "signed_out") codeRef.current?.focus();
  }, [state]);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/voice/owner/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const at = data?.availableAt ? new Date(data.availableAt) : null;
        setError(at ? `Too many wrong codes. Try again at ${formatAvailableAt(at)}.` : (data?.error ?? "Couldn't sign in."));
        return;
      }
      setCode("");
      if (page === 1) await load(1);
      else setPage(1);
      headingRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/voice/owner/session", { method: "DELETE" }).catch(() => {});
    setList(null);
    setState("signed_out");
  }

  async function openCall(item: Item) {
    setOpening(item.sessionId);
    setError(null);
    try {
      const res = await fetch(`/api/voice/owner/transcripts/${encodeURIComponent(item.sessionId)}`, { cache: "no-store" });
      if (res.status === 401) return setState("signed_out");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      setCall({ title: `Call on ${formatCallTime(item.createdAt)}`, lines: data.lines ?? [] });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't load that call.");
    } finally {
      setOpening(null);
    }
  }

  const errorLine = error && (
    <p role="alert" className="text-[14px] text-bad">
      {error}
    </p>
  );

  if (state === "loading") {
    return (
      <p className="mt-8 flex items-center gap-2 text-mist">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </p>
    );
  }

  if (state === "signed_out") {
    return (
      <form onSubmit={signIn} className="mt-8 flex max-w-sm flex-col gap-2">
        <label htmlFor="owner-code" className="text-[13px] text-fog">
          Owner code
        </label>
        <div className="flex items-center gap-2">
          <input
            id="owner-code"
            ref={codeRef}
            type="password"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={200}
            className="min-w-0 flex-1 rounded-2xl border border-line bg-panel px-3.5 py-2 placeholder:text-mist focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={!code.trim() || busy}
            className="shrink-0 rounded-full bg-accent px-4 py-2 font-semibold text-on-accent transition-colors hover:bg-accent-2 disabled:opacity-40"
          >
            Sign in
          </button>
        </div>
        {errorLine}
      </form>
    );
  }

  const items = list?.items ?? [];
  return (
    <section aria-labelledby="owner-calls" className="mt-8 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="owner-calls" ref={headingRef} tabIndex={-1} className="font-semibold focus:outline-none">
          {list?.total.toLocaleString() ?? 0} {list?.total === 1 ? "call" : "calls"}
        </h2>
        <button type="button" onClick={signOut} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-fog hover:bg-panel-2 hover:text-ink">
          <LogOut className="size-3.5" /> Sign out
        </button>
      </div>
      {errorLine}

      {items.length === 0 ? (
        <p className="text-fog">No saved calls in the last 30 days.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line rounded-3xl border border-line bg-panel">
          {items.map((item) => (
            <li key={item.sessionId} className="flex items-center gap-3 px-5 py-3">
              <time dateTime={item.createdAt} className="flex-1 tabular-nums">
                {formatCallTime(item.createdAt)}
              </time>
              <button
                type="button"
                onClick={() => openCall(item)}
                aria-busy={opening === item.sessionId}
                aria-label={`Open transcript of the call on ${formatCallTime(item.createdAt)}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[13px] text-fog hover:border-accent hover:text-accent"
              >
                {opening === item.sessionId ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />} Transcript
              </button>
            </li>
          ))}
        </ol>
      )}

      {list && list.pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-center gap-3 text-[14px]">
          <button
            type="button"
            onClick={() => setPage((p) => p - 1)}
            disabled={list.page <= 1}
            aria-label="Previous page"
            className="rounded-full border border-line p-2 hover:border-accent disabled:opacity-40"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="tabular-nums text-fog">
            Page {list.page} of {list.pages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={list.page >= list.pages}
            aria-label="Next page"
            className="rounded-full border border-line p-2 hover:border-accent disabled:opacity-40"
          >
            <ChevronRight className="size-4" />
          </button>
        </nav>
      )}

      <TranscriptModal open={!!call} onClose={() => setCall(null)} lines={call?.lines ?? []} labels={OWNER_SPEAKER_LABELS} title={call?.title} />
    </section>
  );
}
