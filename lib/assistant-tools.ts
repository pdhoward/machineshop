import "server-only";

import { MAX_SHOWN } from "./assistant-skills";
import { cardsByIds, product, search } from "./catalog";
import { money, type ProductCard } from "./product";

export { assistantInstructions, MAX_SHOWN, SKILLS, type Skill } from "./assistant-skills";

/**
 * The assistant's skills over the catalog (search, read one product, show
 * products to the shopper), shared by typed chat and voice so both can only
 * recommend things that exist. Read-only, like everything in lib/catalog.ts.
 */

/**
 * Runs one skill and returns its result as text for the model. `show_products`
 * replaces `shown` with the real catalog cards for those ids (at most 6).
 */
export async function runTool(name: string, input: Record<string, unknown>, shown: ProductCard[]): Promise<string> {
  if (name === "search_products") {
    const { items, total } = await search(
      {
        q: String(input.query ?? ""),
        maxPrice: typeof input.max_price === "number" ? input.max_price : undefined,
        minPrice: typeof input.min_price === "number" ? input.min_price : undefined,
        inStockOnly: input.in_stock_only === true,
      },
      1,
      12,
    );
    return JSON.stringify({
      total,
      products: items.map((p) => ({ id: p.id, name: p.name, price: money(p.price, p.currency), inStock: p.inStock, category: p.category, blurb: p.blurb })),
    });
  }
  if (name === "get_product") {
    const p = await product(String(input.id ?? ""));
    if (!p) return JSON.stringify({ error: "No product with that id." });
    return JSON.stringify({
      id: p.id, name: p.name, brand: p.brand, price: money(p.price, p.currency), inStock: p.inStock, categories: p.categories,
      description: p.description.slice(0, 1200), highlights: p.highlights.slice(0, 10), specs: p.specs.slice(0, 25),
    });
  }
  if (name === "show_products") {
    const ids = Array.isArray(input.ids) ? input.ids.map(String) : [];
    shown.splice(0, shown.length, ...(await cardsByIds(ids.slice(0, MAX_SHOWN))));
    return "Shown.";
  }
  return JSON.stringify({ error: `Unknown tool ${name}` });
}
