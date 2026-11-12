import type { RuntimeBook } from "../book";
import { selectProducts } from "./commerce/catalog-relevance";

/**
 * The pack kernels this runtime carries (gen3-cradle.md §1.6), by the key
 * their pack declares. A kernel runs only when the site's industry pack offers
 * it (the runtime book lists the pack's kernels), so a hospitality site never
 * gets commerce's idea of a product. Each pack's kernels live in a folder
 * named for the pack; B12 ships them in the @accelerator/cradle package.
 */

export type Order = "relevance" | "price_low" | "price_high" | "rating";
export type Candidate = { title: string; trail?: string[]; price: number | null; rating: number | null };
/** Which candidates to show, in what order: the exact half of a search. */
export type Selector = <T>(items: T[], query: string, view: (item: T) => Candidate, order: Order, count: number) => T[];

const SELECTORS: Record<string, Selector> = {
  "catalog-relevance": selectProducts,
};

/**
 * Without a pack kernel: the catalog's own order (already sorted by the
 * catalog when an order was asked for), cut to the count. Exact, but it can't
 * tell a product from a part that fits it.
 */
const plain: Selector = (items, _query, _view, _order, count) => items.slice(0, count);

/** The selector for this site: the first its pack offers and this runtime carries. */
export function productSelector(book: RuntimeBook | null): { kernel: string | null; select: Selector } {
  for (const k of book?.pack?.kernels ?? []) {
    if (k.status === "available" && SELECTORS[k.key]) return { kernel: k.key, select: SELECTORS[k.key]! };
  }
  return { kernel: null, select: plain };
}
