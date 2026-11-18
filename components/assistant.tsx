"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Assistant as Panel, AskButton as Ask, VoiceChatProvider, type Item } from "@accelerator/voice-chat/react";

import type { ProductCard as Card } from "@/lib/product";

import { ProductCard } from "./product-card";

/**
 * The shop assistant on every page: @accelerator/voice-chat's launcher, typed chat and voice call, with Machine Shop's
 * product cards, its router and its words. Pages ask it questions through <AskButton>.
 */

const STARTERS = ["A gift under $50 for someone who loves to cook", "Brightest outdoor lights for a patio", "A sturdy cordless drill for a beginner"];

export function ShopAssistantProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <VoiceChatProvider
      site={{
        navigate: (url) => router.push(url),
        renderItem: (item: Item) => <ProductCard p={item.data as Card} compact />,
        itemHref: (id) => `/p/${encodeURIComponent(id)}`,
        itemNoun: "Product",
        filePrefix: "machine-shop-call",
        copy: {
          name: "Shop assistant",
          chatHint: "Knows every product in the store",
          launcher: "Shop assistant",
          intro: "Tell me what you're working on and I'll find the right things. For example:",
          thinking: "Looking through the shelves…",
          placeholder: "Ask about any product…",
          liveTitle: "Live with the Shop Assistant",
          notEnabled: "The assistant isn't switched on for this store yet (it needs an ANTHROPIC_API_KEY).",
        },
      }}
    >
      {children}
    </VoiceChatProvider>
  );
}

export function Assistant({ enabled, voice = false }: { enabled: boolean; voice?: boolean }) {
  return (
    <ShopAssistantProvider>
      <Panel chat={enabled} voice={voice} starters={STARTERS} />
    </ShopAssistantProvider>
  );
}

export function AskButton({ prompt, label }: { prompt: string; label: string }) {
  return (
    <Ask prompt={prompt} className="inline-flex items-center gap-2 self-start rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-on-accent transition-colors hover:bg-accent-2">
      {label}
    </Ask>
  );
}
