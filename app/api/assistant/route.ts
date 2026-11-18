import { assistant } from "@/lib/assistant";

/** Cradle mode proves new rules after a response is sent (the conformance gate); give it time. */
export const maxDuration = 300;

/** The shop assistant's typed chat, from @accelerator/voice-chat with the catalog skills (lib/assistant.ts). */
export const POST = assistant.chat;
