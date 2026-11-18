import "server-only";

import { createVoiceChat, type Item } from "@accelerator/voice-chat/server";

import { assistantInstructions, SKILLS } from "./assistant-skills";
import { runTool } from "./assistant-tools";
import { catalogConfigured } from "./catalog";
import { cradleAssistantInstructions, ensureBuyNow } from "./cradle/assistant";
import { cradleConfigured } from "./cradle/book";
import { compiledRules } from "./cradle/compile";
import { reportFault } from "./cradle/fault";
import { costOf } from "./cradle/model";
import { reportUsage } from "./cradle/usage";
import { money, type ProductCard } from "./product";
import { speedBump } from "./speed-bump";

/**
 * The shop assistant, on @accelerator/voice-chat: typed chat (Claude) and a voice call (OpenAI realtime), both with the
 * catalog skills in lib/assistant-tools.ts, so they can only recommend things that exist. Browse-and-advise only: no
 * ordering. Everything here is Machine Shop's own; the package does the rest (B32).
 */

const STYLE = "Keep replies short and warm: 2 to 5 sentences, plain text, no markdown headings or tables. Mention prices.";
const VOICE_STYLE =
  "You are speaking aloud on a live call. Keep replies to 1 to 3 short sentences in plain spoken language: no lists, links, markdown or symbols. Say prices the way a person would. If the shopper interrupts, stop and answer what they just said. Whenever you mention specific products, call show_products with their ids in the same reply.";

/** A catalog card as the package's item, keeping the full card for Machine Shop's own <ProductCard>. */
export const toItem = (p: ProductCard): Item => ({ id: p.id, title: p.name, href: `/p/${encodeURIComponent(p.id)}`, image: p.image, subtitle: p.brand, meta: money(p.price, p.currency), data: p });

// Cradle mode runs the current Sonnet (it must follow the book exactly; the conformance gate checks it).
const MODEL = () => process.env.ASSISTANT_MODEL || (cradleConfigured() ? "claude-sonnet-5-5" : "claude-sonnet-5");

export const assistant = createVoiceChat({
  skills: SKILLS,
  textStyle: STYLE,
  voiceStyle: VOICE_STYLE,
  // Cradle mode: the instructions come from the policy book in force, not from code.
  instructions: async (style) => (cradleConfigured() ? await cradleAssistantInstructions(style).catch(() => assistantInstructions(style)) : assistantInstructions(style)),
  async runSkill(name, args, { mode }) {
    const shown: ProductCard[] = [];
    const found: ProductCard[] = [];
    const open: { url: string }[] = [];
    const output = await runTool(name, args, shown, mode === "voice" ? found : undefined, open);
    return {
      output,
      ...(name === "show_products" && { show: shown.map(toItem) }),
      ...(found.length && { found: found.map(toItem) }),
      ...(open[0] && { open: open[0].url }),
    };
  },
  ready: catalogConfigured,
  forbidUri: process.env.MONGODB_URI,
  itemId: /^[a-f0-9]{24}$/i,
  chat: {
    model: MODEL,
    // …and a shopper who wants to buy is always told how (Buy now), when the rules allow it.
    finish: async (question, reply) => {
      if (!cradleConfigured()) return reply;
      const buyNow = (await compiledRules().catch(() => null))?.projection.assistant.mayDirectToBuyNow ?? false;
      return ensureBuyNow(question, reply, buyNow);
    },
    // What each reply cost, reported to the Accelerator's Spend page (cradle mode only, inside reportUsage).
    onUsage: (u) => reportUsage("assistant", { model: u.model, ...costOf(u.model, u) }),
    // Out of credit, a bad key…: the Accelerator shows it (B18).
    onError: (err, model) => {
      if (cradleConfigured()) reportFault("assistant", model, err);
    },
    limited: speedBump(30, 10 * 60_000),
    copy: { notSetUp: "The assistant isn't set up yet.", noAnswer: "I searched a lot but couldn't settle on an answer. Could you tell me a bit more about what you need?" },
  },
});
