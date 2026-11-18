import { assistant } from "@/lib/assistant";

/** Cradle mode proves new rules after a response is sent (the conformance gate); give it time. */
export const maxDuration = 300;

/**
 * Talk mode's routes, from @accelerator/voice-chat: /session (status, start with the access code, hang up), /tool (a
 * catalog skill during a live call), /transcript (the caller's own lines) and /owner/* (the saved calls behind the
 * owner code). The OpenAI key never leaves the server; the browser gets a one-call pass.
 */
export const { GET, POST, DELETE } = assistant.voiceRoutes;
