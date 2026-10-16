"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";

/**
 * Opens the browser's print window once the sheet's photo has loaded, so
 * "Save as PDF" keeps it. The button opens it again; it isn't printed.
 */
export function PrintSheet() {
  useEffect(() => {
    let done = false;
    const print = () => {
      if (done) return;
      done = true;
      window.print();
    };
    const pending = [...document.images].filter((img) => !img.complete);
    let left = pending.length;
    if (!left) return void setTimeout(print, 100);
    for (const img of pending) {
      const one = () => (--left === 0 ? print() : undefined);
      img.addEventListener("load", one, { once: true });
      img.addEventListener("error", one, { once: true });
    }
    // Don't wait forever on a slow photo.
    const id = setTimeout(print, 4000);
    return () => {
      done = true;
      clearTimeout(id);
    };
  }, []);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-[13.5px] font-semibold text-on-accent transition-colors hover:bg-accent-2 print:hidden"
    >
      <Printer className="size-4" /> Print or save as PDF
    </button>
  );
}
