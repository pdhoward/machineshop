"use client";

import { OwnerTranscripts as List } from "@accelerator/voice-chat/react";

import { ShopAssistantProvider } from "./assistant";

/** The owner's saved calls, from @accelerator/voice-chat, with Machine Shop's product links and words. */
export function OwnerTranscripts() {
  return (
    <div className="mt-8">
      <ShopAssistantProvider>
        <List labels={{ user: "Shopper", assistant: "Assistant" }} />
      </ShopAssistantProvider>
    </div>
  );
}
