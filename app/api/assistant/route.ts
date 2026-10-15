import Anthropic from "@anthropic-ai/sdk";

import { assistantInstructions, runTool, SKILLS } from "@/lib/assistant-tools";
import { catalogConfigured } from "@/lib/catalog";
import type { ProductCard } from "@/lib/product";

/**
 * The shop assistant. Claude answers with the three skills in
 * lib/assistant-tools.ts (search, read one product, show products to the
 * shopper), so it can only recommend things that exist. Browse-and-advise
 * only: no ordering.
 */

const MODEL = () => process.env.ASSISTANT_MODEL || "claude-sonnet-5";
const MAX_TURNS = 6;

const SYSTEM = assistantInstructions("Keep replies short and warm: 2 to 5 sentences, plain text, no markdown headings or tables. Mention prices.");

const TOOLS: Anthropic.Tool[] = SKILLS.map((s) => ({ name: s.name, description: s.description, input_schema: s.parameters }));

type Msg = { role: "user" | "assistant"; content: string };

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
  const shown: ProductCard[] = [];
  const said: string[] = []; // text from every step, including what Claude says before a tool call

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await client.messages.create({ model: MODEL(), max_tokens: 1024, system: SYSTEM, tools: TOOLS, messages });
      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      for (const b of res.content) if (b.type === "text" && b.text.trim()) said.push(b.text.trim());
      if (res.stop_reason !== "tool_use" || !toolUses.length) {
        return Response.json({ reply: said.join("\n\n") || "Here's what I found.", products: shown });
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
      products: shown,
    });
  } catch (err) {
    console.error("[assistant]", err);
    return Response.json({ error: "The assistant hit a snag. Try again in a moment." }, { status: 502 });
  }
}
