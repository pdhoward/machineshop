/**
 * The Commerce pack's catalog-relevance kernel (gen3-cradle.md §1.6, B9).
 * Written once for the pack and run on every commerce site; no site writes
 * its own. It does the exact part of search: which candidates are the product
 * the shopper named, and their order by relevance, price or rating. The model
 * does the interpreting part: reading the shopper's words into keywords, an
 * order and a count.
 *
 * The store's catalog connection only has to return candidates where every
 * keyword appears somewhere (the simplest search any web app already has);
 * this ranks them so the thing the shopper asked for comes before the parts
 * and accessories that merely mention it.
 *
 * It reads only a title and a category trail, which every catalog has, and
 * uses how product titles are written: the subject comes first, and what an
 * accessory fits comes after "for", "fits" or "compatible with" ("Blade Set
 * for Select Riding Lawn Mowers" is a blade set, not a lawn mower). The
 * candidates' original order breaks ties, so the kernel's own order survives
 * when the words don't tell products apart.
 */

export type Rankable = { title: string; trail?: string[] };

/** Where a title stops naming the product and starts naming what it fits. */
const QUALIFIER = /\b(?:for|fits|fit|compatible with|works with|designed for|replacement for|to fit|use with|for use with)\b/i;

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** The forms a keyword may take in a title: drill, drills; box, boxes; battery, batteries. */
function forms(term: string): string[] {
  const out = new Set([term]);
  if (term.endsWith("ies") && term.length > 4) out.add(`${term.slice(0, -3)}y`);
  else if (term.endsWith("es") && term.length > 3) out.add(term.slice(0, -2));
  if (term.endsWith("s") && term.length > 3) out.add(term.slice(0, -1));
  if (term.endsWith("y")) out.add(`${term.slice(0, -1)}ies`);
  out.add(`${term}s`);
  out.add(`${term}es`);
  return [...out];
}

const hasWord = (tokens: string[], term: string) => forms(term).some((f) => tokens.includes(f));
const hasPart = (text: string, term: string) => text.includes(term) || forms(term).some((f) => text.includes(f));

/** How well one candidate matches the keywords. Exposed for tests and the Why? record. */
export function relevance(item: Rankable, query: string): number {
  const terms = [...new Set(words(query))];
  if (!terms.length) return 0;
  const title = item.title.toLowerCase();
  const cut = title.search(QUALIFIER);
  const subject = cut > 0 ? title.slice(0, cut) : title;
  const qualifier = cut > 0 ? title.slice(cut) : "";
  const subjectWords = words(subject);
  const qualifierWords = words(qualifier);
  const trail = (item.trail ?? []).map((t) => t.toLowerCase());
  const leaf = words(trail.at(-1) ?? "");
  const trailWords = words(trail.join(" "));

  let score = 0;
  let inSubject = 0;
  for (const t of terms) {
    if (hasWord(subjectWords, t)) (score += 3), inSubject++;
    else if (hasPart(subject, t)) (score += 1.5), inSubject++;
    else if (hasWord(qualifierWords, t)) score -= 1; // named only as what it fits: an accessory
    if (hasWord(leaf, t)) score += 2; // the product's own category says it is the thing
    else if (hasWord(trailWords, t)) score += 0.5;
  }
  if (inSubject === terms.length) score += 2; // every keyword names the product itself
  // The keywords as a phrase, in order ("lawn mower"), within the subject.
  if (terms.length > 1) {
    const phrase = terms.map((t) => `(?:${forms(t).join("|")})`).join("[^a-z0-9]+");
    if (new RegExp(`\\b${phrase}\\b`).test(subject)) score += 2;
  }
  return score;
}

/** The candidates, most relevant first; ties keep the kernel's order. */
export function rankByRelevance<T>(items: T[], query: string, view: (item: T) => Rankable): T[] {
  return items
    .map((item, i) => ({ item, i, score: relevance(view(item), query) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.item);
}

/** Whether every keyword names the product itself (in its title before any "for"), not only what it fits or its category. */
export function namesIt(item: Rankable, query: string): boolean {
  const terms = [...new Set(words(query))];
  if (!terms.length) return true;
  const title = item.title.toLowerCase();
  const cut = title.search(QUALIFIER);
  const subject = cut > 0 ? title.slice(0, cut) : title;
  const subjectWords = words(subject);
  return terms.every((t) => hasWord(subjectWords, t) || hasPart(subject, t));
}

export type Order = "relevance" | "price_low" | "price_high" | "rating";

/**
 * The products to show, from the kernel's candidates: by relevance; or, when
 * the shopper asked for an order ("the cheapest", "best rated"), only the
 * products the keywords name, in that order, so the cheapest lawn mower is a
 * mower and not a blade that fits one. Falls back to every candidate only
 * when the keywords name none of them. `count` is how many to keep.
 */
export function selectProducts<T>(
  items: T[],
  query: string,
  view: (item: T) => Rankable & { price: number | null; rating: number | null },
  order: Order,
  count: number,
): T[] {
  const ranked = rankByRelevance(items, query, view);
  if (order === "relevance") return ranked.slice(0, count);
  const named = ranked.filter((x) => namesIt(view(x), query));
  // Fewer than asked is honest; padding with parts that merely mention the keywords is not.
  const pool = named.length ? named : ranked;
  const key = (x: T) => {
    const v = view(x);
    return order === "rating" ? -(v.rating ?? -1) : order === "price_high" ? -(v.price ?? -Infinity) : (v.price ?? Infinity);
  };
  return pool
    .map((x, i) => ({ x, i }))
    .sort((a, b) => key(a.x) - key(b.x) || a.i - b.i)
    .map((e) => e.x)
    .slice(0, count);
}
