/**
 * Relevance ranking for any catalog (B9): platform code, not the store's. The
 * store's search kernel only has to return candidates where every keyword
 * appears somewhere (the simplest search any web app already has); this
 * ranks them so the thing the shopper asked for comes before the parts and
 * accessories that merely mention it.
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
