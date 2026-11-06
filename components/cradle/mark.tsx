import { getRuntime, MARK, cradleConfigured } from "@/lib/cradle/book";

/**
 * The Cradle mark (the same on every transformed site): "Running on AI ·
 * Intelligence matters" in a moving gradient. Its words come from the
 * Accelerator, so every Cradle site says the same thing.
 */
export async function CradleMark({ size = "header" }: { size?: "header" | "hero" }) {
  if (!cradleConfigured()) return null;
  const mark = (await getRuntime())?.mark ?? MARK;
  if (size === "hero")
    return (
      <p className="cradle-gradient mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
        {mark.title}. {mark.tagline}.
      </p>
    );
  return (
    <span className="cradle-mark hidden shrink-0 items-center gap-2 rounded-full px-3 py-1 md:inline-flex" title={`${mark.title} · ${mark.by}`}>
      <span className="cradle-dot" aria-hidden />
      <span className="cradle-gradient text-[12.5px] font-semibold tracking-tight">
        {mark.title} · {mark.tagline}
      </span>
    </span>
  );
}
