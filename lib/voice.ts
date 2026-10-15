import { assistantInstructions, MAX_SHOWN, SKILLS } from "./assistant-tools";

/**
 * Talk mode's rules as pure functions: the access code, lockout, cooldown, the
 * 5-minute timer, transcript cleanup, the configuration check and the OpenAI
 * realtime session settings. No database or network here; the voice routes
 * and lib/voice-store.ts do that, using these rules.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// --- Access code ------------------------------------------------------------

/**
 * True only when `given` matches a configured `expected` code. The comparison
 * runs over every byte of the longer input, so its timing doesn't reveal how
 * much of a guess was right. An empty guess or an unset code never matches.
 */
export function codeMatches(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// --- Lockout: 5 wrong codes, then 1 hour ------------------------------------

export const MAX_MISSES = 5;
export const LOCKOUT_MS = HOUR;

/** Wrong-code record for one caller, as stored by lib/voice-store.ts. */
export type Attempts = { count: number; lockedUntil: Date | null };

export const isLockedOut = (a: Attempts | null | undefined, now: Date) =>
  !!a?.lockedUntil && now.getTime() < a.lockedUntil.getTime();

/** The record after one more wrong code. A lifted lockout starts the count again. */
export function recordMiss(a: Attempts | null | undefined, now: Date): Attempts {
  const lifted = !!a?.lockedUntil && !isLockedOut(a, now);
  const count = (a && !lifted ? a.count : 0) + 1;
  return { count, lockedUntil: count >= MAX_MISSES ? new Date(now.getTime() + LOCKOUT_MS) : null };
}

// --- Call length and cooldown -----------------------------------------------

export const CALL_MS = 5 * MINUTE;
export const COOLDOWN_MS = 3 * HOUR;

export const callEndsAt = (start: Date) => new Date(start.getTime() + CALL_MS);

/** When Talk is available again after a call that started at `start`: start + 5 min + 3 h. */
export const talkAvailableAt = (start: Date) => new Date(start.getTime() + CALL_MS + COOLDOWN_MS);

/** Whether a caller whose last call started at `lastStart` may talk at `now`. */
export const canTalk = (lastStart: Date | null | undefined, now: Date) =>
  !lastStart || now.getTime() >= talkAvailableAt(lastStart).getTime();

// --- Timer ------------------------------------------------------------------

export const FINAL_MS = 30_000;

export type TimerPhase = "normal" | "final" | "over";

/** The timer's phase with `remainingMs` left: the last 30 seconds are "final", zero or less is "over". */
export function timerPhase(remainingMs: number): TimerPhase {
  if (remainingMs <= 0) return "over";
  if (remainingMs <= FINAL_MS) return "final";
  return "normal";
}

// --- Transcript lines -------------------------------------------------------

export const SPEAKERS = ["shopper", "assistant"] as const;
export type Speaker = (typeof SPEAKERS)[number];
export const MAX_LINE_CHARS = 2000;
export const MAX_LINES = 50;

export type TranscriptLine = { speaker: Speaker; text: string; at: Date; productIds: string[] };

const PRODUCT_ID = /^[a-f0-9]{24}$/i;

/**
 * Turns untrusted input from the browser into transcript lines: known speakers
 * only, whitespace tidied, text cut to 2,000 characters, empty lines dropped,
 * at most 50 lines, and at most 6 well-formed product ids per line. A missing
 * or unreadable time becomes `now`.
 */
export function cleanLines(input: unknown, now: Date): TranscriptLine[] {
  if (!Array.isArray(input)) return [];
  const lines: TranscriptLine[] = [];
  for (const raw of input) {
    if (lines.length >= MAX_LINES) break;
    if (!raw || typeof raw !== "object") continue;
    const { speaker, text, at, productIds } = raw as Record<string, unknown>;
    if (!SPEAKERS.includes(speaker as Speaker) || typeof text !== "string") continue;
    const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_LINE_CHARS);
    if (!clean) continue;
    const time = typeof at === "number" || typeof at === "string" ? new Date(at) : null;
    lines.push({
      speaker: speaker as Speaker,
      text: clean,
      at: time && !Number.isNaN(time.getTime()) ? time : now,
      productIds: Array.isArray(productIds)
        ? productIds.filter((id): id is string => typeof id === "string" && PRODUCT_ID.test(id)).slice(0, MAX_SHOWN)
        : [],
    });
  }
  return lines;
}

// --- Configuration ----------------------------------------------------------

export const VOICE_SETTINGS = [
  "OPENAI_API_KEY",
  "VOICE_MODEL",
  "VOICE_ACCESS_CODE",
  "VOICE_OWNER_CODE",
  "VOICE_SECRET",
  "VOICE_MONGODB_URI",
  "VOICE_MONGODB_DB",
] as const;

/** The voice settings that are unset or blank. Talk mode runs only when this is empty. */
export const missingVoiceSettings = (env: Record<string, string | undefined> = process.env) =>
  VOICE_SETTINGS.filter((k) => !env[k]?.trim());

export const voiceConfigured = (env: Record<string, string | undefined> = process.env) =>
  missingVoiceSettings(env).length === 0;

// --- OpenAI realtime session ------------------------------------------------

/** Output token cap for each spoken reply. */
export const VOICE_MAX_OUTPUT_TOKENS = 1024;

export const VOICE_STYLE =
  "You are speaking aloud on a live call. Keep replies to 1 to 3 short sentences in plain spoken language: no lists, links, markdown or symbols. Say prices the way a person would. If the shopper interrupts, stop and answer what they just said.";

/**
 * The `session` settings for OpenAI's realtime client-secret request: the
 * three shared catalog skills and nothing else, spoken-style instructions with
 * the only-real-products rule, a per-reply token cap, and transcription of the
 * shopper's speech so it can be captioned and saved.
 */
export function buildSessionConfig(model: string) {
  return {
    type: "realtime" as const,
    model,
    instructions: assistantInstructions(VOICE_STYLE),
    output_modalities: ["audio"],
    max_output_tokens: VOICE_MAX_OUTPUT_TOKENS,
    audio: {
      input: { transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "semantic_vad" } },
    },
    tools: SKILLS.map((s) => ({ type: "function" as const, name: s.name, description: s.description, parameters: s.parameters })),
    tool_choice: "auto" as const,
  };
}
