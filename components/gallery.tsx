"use client";

import { useState } from "react";
import clsx from "clsx";
import { ImageOff } from "lucide-react";

/** Big photo plus thumbnails; click a thumbnail to swap. */
export function Gallery({ images, name }: { images: string[]; name: string }) {
  const [at, setAt] = useState(0);
  if (!images.length) {
    return (
      <div className="photo grid aspect-square place-items-center rounded-3xl border border-line text-mist">
        <ImageOff className="size-10" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="photo aspect-square overflow-hidden rounded-3xl border border-line">
        {/* eslint-disable-next-line @next/next/no-img-element -- remote catalog images */}
        <img src={images[at]} alt={name} className="size-full object-contain p-6 sm:p-10" />
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setAt(i)}
              aria-label={`Photo ${i + 1} of ${images.length}`}
              aria-pressed={i === at}
              className={clsx("photo size-20 shrink-0 overflow-hidden rounded-xl border-2 transition-colors", i === at ? "border-accent" : "border-line hover:border-fog")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- remote catalog images */}
              <img src={src.replace(/_1000\./, "_400.")} alt="" loading="lazy" className="size-full object-contain p-1.5" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
