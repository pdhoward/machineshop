import Anthropic from "@anthropic-ai/sdk";

import { cardsByIds, catalogConfigured, product, search } from "@/lib/catalog";
import { money } from "@/lib/product";

/**
 * The shop assistant. Claude answers with three tools over the catalog
 * (search, read one product, show products to the shopper), so it can only
 * recommend things that exist. Browse-and-advise only: no ordering.
 */

const MODEL = () => process.env.ASSISTANT_MODEL || "claude-sonnet-5";
const MAX_TURNS = 6;

const SYSTEM = `You are the shop assistant at Machine Shop, an online store of about 10,000 home and workshop products (tools, decor, lighting, furniture, appliances and more).

How you work:
- Always find products with search_products before recommending anything. Search with short, concrete terms (e.g. "cordless drill", "area rug 8x10"); try a second search with different words if the first finds little.
- Use get_product when the shopper asks about one product's details.
- When you recommend products, call show_products once with the ids (best first, at most 6) so the shopper sees them as cards.
- Only mention products, prices and specs that came from your tools. Never invent them.
- Keep replies short and warm: 2 to 5 sentences, plain text, no markdown headings or tables. Mention prices.
- This is a demonstration store: shoppers can browse and ask, but can't order. If asked to buy, say so kindly and help them choose.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_products",
    description: "Search the catalog. Every word must match the name, brand or category. Returns up to 12 products.",
    input_schema: {
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
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "show_products",
    description: "Show these products to the shopper as cards, best first (max 6). Call once per reply when recommending.",
    input_schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] },
  },
];

type Msg = { role: "user" | "assistant"; content: string };

async function runTool(name: string, input: Record<string, unknown>, shown: string[]): Promise<string> {
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
    shown.splice(0, shown.length, ...ids.slice(0, 6));
    return "Shown.";
  }
  return JSON.stringify({ error: `Unknown tool ${name}` });
}

// A soft per-IP speed bump (per server instance); the model's own cost is capped by max_tokens and turns.
const hits = new Map<string, { n: number; until: number }>();
function limited(ip: string) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.until < now) {
    hits.set(ip, { n: 1, until: now + 10 * 60_000 });
    return false;
  }
  return ++h.n > 30;
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "The assistant isn't set up yet." }, { status: 503 });
  if (!catalogConfigured()) return Response.json({ error: "The catalog isn't connected yet." }, { status: 503 });
  if (limited(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local")) {
    return Response.json({ error: "That's a lot of questions! Give it a few minutes." }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as { messages?: Msg[] } | null;
  const history = (body?.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (history.at(-1)?.role !== "user") return Response.json({ error: "Ask a question." }, { status: 400 });

  // Keys not scoped to one workspace must name it (ANTHROPIC_WORKSPACE_ID).
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
  const messages: Anthropic.MessageParam[] = history;
  const shown: string[] = [];
  const said: string[] = []; // text from every step, including what Claude says before a tool call

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await client.messages.create({ model: MODEL(), max_tokens: 1024, system: SYSTEM, tools: TOOLS, messages });
      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      for (const b of res.content) if (b.type === "text" && b.text.trim()) said.push(b.text.trim());
      if (res.stop_reason !== "tool_use" || !toolUses.length) {
        return Response.json({ reply: said.join("\n\n") || "Here's what I found.", products: await cardsByIds(shown) });
      }
      messages.push({ role: "assistant", content: res.content });
      messages.push({
        role: "user",
        content: await Promise.all(
          toolUses.map(async (t) => ({ type: "tool_result" as const, tool_use_id: t.id, content: await runTool(t.name, t.input as Record<string, unknown>, shown) })),
        ),
      });
    }
    return Response.json({
      reply: said.join("\n\n") || "I searched a lot but couldn't settle on an answer. Could you tell me a bit more about what you need?",
      products: await cardsByIds(shown),
    });
  } catch (err) {
    console.error("[assistant]", err);
    return Response.json({ error: "The assistant hit a snag. Try again in a moment." }, { status: 502 });
  }
}
