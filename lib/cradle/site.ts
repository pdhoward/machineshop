import type { RuntimeBook } from "./book";

/**
 * Who the app is and what it reads its rules from, taken from the book the
 * Accelerator serves (never from code written for one site):
 *  - the site as its owner registered it (name and description);
 *  - the industry pack (what the industry is, and which concepts each use grounds on).
 * The same code then runs any Cradle site of any industry.
 */

export type GroundingUse = "search" | "assistant" | "scenarios";

/** One sentence the app's prompts open with: the site's own description, else its industry pack's. */
export function introduce(book: RuntimeBook | null): string {
  if (!book) return "this site";
  const { site, pack } = book;
  const what = site.description?.trim() || (pack?.summary ? `a ${pack.label ?? pack.id} site (${pack.summary.replace(/\.$/, "")})` : "");
  return what ? `${site.name}: ${what.replace(/\.$/, "")}` : site.name;
}

/** The concepts this use reads its rules from: the pack's grounding, else every concept in the book. */
export function groundingFor(book: RuntimeBook, use: GroundingUse): string[] {
  const listed = book.pack?.grounding?.[use];
  return listed?.length ? listed : [...new Set(book.policies.map((p) => p.concept))].sort();
}
