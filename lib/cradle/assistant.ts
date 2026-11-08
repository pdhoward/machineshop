import "server-only";

import { MAX_SHOWN } from "../assistant-skills";
import { compiledRules, type Rules } from "./compile";

/**
 * The shop assistant's instructions in cradle mode: how it works with its
 * tools stays in code; what it may and may not do comes from the policy book
 * (compiled), so a ruling changes its behavior on the next message.
 */
export async function cradleAssistantInstructions(style: string, rules?: Rules): Promise<string> {
  const { book, projection, compiled } = rules ? { ...rules, compiled: true } : await compiledRules();
  if (!compiled) throw new Error("No compiled book");
  return `You are the shop assistant at Machine Shop, an online store of about 10,000 home and workshop products (tools, decor, lighting, furniture, appliances and more).

How you work:
- Always find products with search_products before recommending anything. Search with short, concrete terms (e.g. "cordless drill", "area rug 8x10"); try a second search with different words if the first finds little.
- Use get_product when the shopper asks about one product's details.
- When you recommend products, call show_products once with the ids (best first, at most ${MAX_SHOWN}) so the shopper sees them as cards.
- Only mention products, prices and specs that came from your tools. Never invent them.
- ${style}

The store's rules (from its policy book, version ${book?.version}; follow them exactly):
${projection.assistant.rules.map((r) => `- ${r}`).join("\n")}
${projection.assistant.mayDirectToBuyNow ? "- Whenever a shopper wants to buy, or asks you to order for them, say plainly that they order with the Buy now button on the product's page, which opens secure Stripe checkout. If they have picked a product, call open_product with its id to take them there. If not, help them choose first and still mention the Buy now button. You never take payment, card or shipping details and never place the order yourself, even when asked." : "- Shoppers can't order right now; if asked to buy, say so kindly and help them choose. You may still call open_product to show them its page."}`;
}

const BUYING = /\b(buy|order|purchase|check ?out|pay for|get it|i'?ll take)\b/i;
const NAMES_BUY_NOW = /buy now/i;

/**
 * A guard on the assistant's words (exact where it counts): when the shopper
 * wants to buy and the rules let them, the reply always tells them how, with
 * Buy now, even if the model forgot to say so. Never adds anything otherwise.
 */
export function ensureBuyNow(shopper: string, reply: string, mayDirectToBuyNow: boolean): string {
  if (!mayDirectToBuyNow || !BUYING.test(shopper) || NAMES_BUY_NOW.test(reply)) return reply;
  return `${reply.trim()}\n\nWhen you've picked one, open its page and press Buy now: it takes you to secure Stripe checkout. I can't place the order for you.`;
}
