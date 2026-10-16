"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import Link from "next/link";
import { Download, X } from "lucide-react";

import { EMPTY_TRANSCRIPT_TEXT, transcriptRows, transcriptText, type Speaker, type StoredLine } from "@/lib/voice";

/**
 * The transcript window: who spoke, when, and links to the products shown,
 * with a Download button that saves the same lines as a text file.
 * A modal <dialog>, so the page behind it is inert. Tab wraps inside it, Esc
 * (or the close button, or a click outside) calls `onClose`, and focus goes
 * back to whatever opened it. Used by the Talk panel during and after a call,
 * and by the owner view. The rows come from transcriptRows in lib/voice.ts.
 */

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function TranscriptModal({
  open,
  onClose,
  lines,
  names,
  labels,
  title = "Call transcript",
  live = false,
}: {
  open: boolean;
  onClose: () => void;
  lines: readonly StoredLine[];
  /** Product names the caller already knows, by id, for the links. */
  names?: Record<string, string>;
  /** Speaker labels; the shopper is "You" unless the owner view says otherwise. */
  labels?: Record<Speaker, string>;
  title?: string;
  /** The call is still going, so new lines arrive while the window is open. */
  live?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const rows = transcriptRows(lines, { names, labels });

  // Open as a modal, and on close hand focus back to the opener.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d || !open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    return () => {
      if (d.open) d.close();
      openerRef.current?.focus();
    };
  }, [open]);

  // Keep the newest line in view as the call goes on.
  useEffect(() => {
    if (open) listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [open, rows.length]);

  /** Saves the lines already on screen as a .txt file; nothing is fetched or sent. */
  function download() {
    const { text, fileName } = transcriptText(lines, { origin: window.location.origin, names, labels });
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.key !== "Tab") return;
    const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        // Esc: let React close it, so focus goes back the same way every time.
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto max-h-[80vh] w-[min(92vw,560px)] flex-col overflow-hidden open:flex rounded-3xl border border-line bg-panel p-0 text-ink shadow-2xl backdrop:bg-bg/70"
    >
      <header className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <div className="flex-1 leading-tight">
          <h2 id={titleId} className="font-semibold">
            {title}
          </h2>
          <p id={descId} className="text-[12px] text-mist">
            {live ? "Updates live during the call." : "Who spoke, when, and the products shown."}
          </p>
        </div>
        <button
          type="button"
          onClick={download}
          disabled={rows.length === 0}
          aria-label="Download transcript as a text file"
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[12.5px] font-medium text-fog hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40"
        >
          <Download className="size-3.5" /> Download
        </button>
        <button type="button" onClick={onClose} aria-label="Close transcript" className="rounded-full p-1.5 text-mist hover:bg-panel-2 hover:text-ink">
          <X className="size-4" />
        </button>
      </header>

      <div tabIndex={0} aria-label="Transcript lines" role="region" className="flex-1 overflow-y-auto px-5 py-4 text-[14px] focus:outline-none">
        {rows.length === 0 ? (
          <p className="text-mist">{live ? "Nothing said yet. Lines appear here as the call goes on." : EMPTY_TRANSCRIPT_TEXT}</p>
        ) : (
          <ol ref={listRef} className="flex flex-col gap-3.5">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-col gap-1">
                <p className="flex items-baseline gap-2 text-[12px]">
                  <span className={r.speaker === "assistant" ? "font-semibold text-accent" : "font-semibold"}>{r.label}</span>
                  {r.time && (
                    <time dateTime={r.dateTime} className="tabular-nums text-mist">
                      {r.time}
                    </time>
                  )}
                </p>
                <p className="whitespace-pre-wrap leading-relaxed">{r.text}</p>
                {r.products.length > 0 && (
                  <ul aria-label="Products mentioned" className="flex flex-wrap gap-1.5">
                    {r.products.map((p) => (
                      <li key={p.id}>
                        <Link
                          href={p.href}
                          onClick={onClose}
                          className="inline-block max-w-[240px] truncate rounded-full border border-line px-2.5 py-0.5 text-[12.5px] text-fog hover:border-accent hover:text-accent"
                        >
                          {p.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </dialog>
  );
}
