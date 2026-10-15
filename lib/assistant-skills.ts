/**
 * The assistant's skill definitions and shared instructions, as plain data
 * with no catalog access, so lib/voice.ts can use them in the browser too.
 * lib/assistant-tools.ts runs the skills on the server and re-exports these.
 */

/** A skill in provider-neutral form: `parameters` is a JSON Schema object. */
export type Skill = {
  name: "search_products" | "get_product" | "show_products";
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required: string[] };
};

export const SKILLS: Skill[] = [
  {
    name: "search_products",
    description: "Search the catalog. Every word must match the name, brand or category. Returns up to 12 products.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Short keywords, e.g. 'pendant light brass'" },
        max_price: { type: "number" },
        min_price: { type: "number" },
        in_stock_only: { type: "boolean" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_product",
    description: "Full details of one product by id: description, highlights and specifications.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "show_products",
    description: "Show these products to the shopper as cards, best first (max 6). Call once per reply when recommending.",
    parameters: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] },
  },
];

export const MAX_SHOWN = 6;

/** The assistant's instructions; `style` is the one line that differs between typed chat and voice. */
export const assistantInstructions = (style: string) => `You are the shop assistant at Machine Shop, an online store of about 10,000 home and workshop products (tools, decor, lighting, furniture, appliances and more).

How you work:
- Always find products with search_products before recommending anything. Search with short, concrete terms (e.g. "cordless drill", "area rug 8x10"); try a second search with different words if the first finds little.
- Use get_product when the shopper asks about one product's details.
- When you recommend products, call show_products once with the ids (best first, at most ${MAX_SHOWN}) so the shopper sees them as cards.
- Only mention products, prices and specs that came from your tools. Never invent them.
- ${style}
- This is a demonstration store: shoppers can browse and ask, but can't order. If asked to buy, say so kindly and help them choose.`;
