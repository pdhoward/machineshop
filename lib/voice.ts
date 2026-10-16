import { assistantInstructions, MAX_SHOWN, SKILLS } from "./assistant-skills";

/**
 * Talk mode's rules as pure functions: the access code, lockout, cooldown, the
 * 5-minute timer, transcript cleanup, the configuration check and the OpenAI
 * realtime session settings, plus the Talk panel's decisions (reading live
 * call events, what to send back, which state to show) and the transcript
 * window's rows and download. No database or
 * network here; the voice routes, lib/voice-store.ts and
 * components/voice-call.tsx do that, using these rules. Safe to import in
 * the browser.
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

/** Time after a call closes during which the browser may still send its last transcript lines. */
export const TRANSCRIPT_GRACE_MS = 30_000;

/**
 * Whether a call is still open at `now`: before its 5-minute end and before it
 * was hung up, whichever is first, plus `graceMs`. This is the server-side cap.
 */
export function callOpen(s: { endsAt: Date; endedAt: Date | null }, now: Date, graceMs = 0): boolean {
  const closed = Math.min(s.endsAt.getTime(), s.endedAt?.getTime() ?? Infinity);
  return now.getTime() < closed + graceMs;
}

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
  "You are speaking aloud on a live call. Keep replies to 1 to 3 short sentences in plain spoken language: no lists, links, markdown or symbols. Say prices the way a person would. If the shopper interrupts, stop and answer what they just said. Whenever you mention specific products, call show_products with their ids in the same reply.";

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

// --- Live call events (browser) ---------------------------------------------

/** Where the browser sends the call's audio offer, with the one-call pass as the bearer. */
export const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export type ToolCall = { callId: string; name: string; arguments: string };

/**
 * What one event from the model's data channel means for the panel:
 * - `caption`: a caption starts, grows by `text`, or is final with the full `text`.
 * - `response_started` / `response_done`: the model began or finished a reply;
 *   `calls` are the skills it asked for, to run and hand back.
 * - `error`: OpenAI reported a problem.
 * Anything else, or unreadable input, is null.
 */
export type RealtimeAction =
  | { kind: "caption"; id: string; speaker: Speaker; text: string; mode: "start" | "append" | "final" }
  | { kind: "response_started" }
  | { kind: "response_done"; calls: ToolCall[] }
  | { kind: "error"; message: string };

export type CaptionAction = Extract<RealtimeAction, { kind: "caption" }>;

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function parseRealtimeEvent(raw: unknown): RealtimeAction | null {
  let e: unknown = raw;
  if (typeof raw === "string") {
    try {
      e = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!e || typeof e !== "object") return null;
  const ev = e as Record<string, unknown>;
  const id = str(ev.item_id);
  switch (ev.type) {
    // The shopper stopped speaking: hold their caption's place before its words arrive.
    case "input_audio_buffer.committed":
      return id ? { kind: "caption", id, speaker: "shopper", text: "", mode: "start" } : null;
    case "conversation.item.input_audio_transcription.delta":
      return id ? { kind: "caption", id, speaker: "shopper", text: str(ev.delta), mode: "append" } : null;
    case "conversation.item.input_audio_transcription.completed":
      return id ? { kind: "caption", id, speaker: "shopper", text: str(ev.transcript), mode: "final" } : null;
    case "response.output_audio_transcript.delta":
      return id ? { kind: "caption", id, speaker: "assistant", text: str(ev.delta), mode: "append" } : null;
    case "response.output_audio_transcript.done":
      return id ? { kind: "caption", id, speaker: "assistant", text: str(ev.transcript), mode: "final" } : null;
    case "response.created":
      return { kind: "response_started" };
    case "response.done": {
      const output = (ev.response as { output?: unknown } | undefined)?.output;
      const calls: ToolCall[] = [];
      for (const item of Array.isArray(output) ? output : []) {
        const it = item as Record<string, unknown> | null;
        if (it?.type !== "function_call" || it.status === "incomplete") continue;
        const callId = str(it.call_id);
        const name = str(it.name);
        if (callId && name) calls.push({ callId, name, arguments: str(it.arguments) });
      }
      return { kind: "response_done", calls };
    }
    case "error":
      return { kind: "error", message: str((ev.error as { message?: unknown } | undefined)?.message) || "Unknown error" };
    default:
      return null;
  }
}

/** One caption in the panel; `at` is when it first appeared (ms). */
export type Caption = { id: string; speaker: Speaker; text: string; at: number; final: boolean };

/** The call's captions, plus product ids shown since the assistant's last line, waiting to join its next one. */
export type CallLog = { captions: Caption[]; pendingProductIds: string[] };

export const emptyCallLog = (): CallLog => ({ captions: [], pendingProductIds: [] });

/** A finished line, ready for POST /api/voice/transcript. */
export type OutgoingLine = { speaker: Speaker; text: string; at: number; productIds: string[] };

/**
 * Applies one caption action. Returns the new log and, when a caption becomes
 * final with words in it, the transcript line to save. An assistant line takes
 * the products shown just before it. A caption is final once; later events for
 * it are ignored, so a line is never saved twice.
 */
export function applyCaption(log: CallLog, a: CaptionAction, now: number): { log: CallLog; line: OutgoingLine | null } {
  const i = log.captions.findIndex((c) => c.id === a.id);
  const existing = i >= 0 ? log.captions[i]! : null;
  if (existing?.final) return { log, line: null };
  const base = existing ?? { id: a.id, speaker: a.speaker, text: "", at: now, final: false };
  const text = a.mode === "final" ? a.text.trim() : a.mode === "append" ? base.text + a.text : base.text;
  const caption: Caption = { ...base, text, final: a.mode === "final" };
  const captions = i >= 0 ? log.captions.map((c, j) => (j === i ? caption : c)) : [...log.captions, caption];
  if (!caption.final || !text) return { log: { ...log, captions }, line: null };

  const takesProducts = caption.speaker === "assistant";
  return {
    log: { captions, pendingProductIds: takesProducts ? [] : log.pendingProductIds },
    line: { speaker: caption.speaker, text, at: caption.at, productIds: takesProducts ? log.pendingProductIds : [] },
  };
}

/** Records the products a skill just showed, for the assistant's next line. */
export const withShownProducts = (log: CallLog, ids: string[]): CallLog => ({ ...log, pendingProductIds: ids.slice(0, MAX_SHOWN) });

/** One row of product cards in the Talk panel; `auto` rows came from a search or lookup, not the model's own pick. */
export type CardGroup<C extends { id: string }> = { at: number; products: C[]; auto: boolean };

/**
 * Adds the cards one skill returned to the panel's rows. Cards a search or
 * lookup `found` add an automatic row. The model's own pick (`picked`, from
 * show_products) replaces the automatic rows added since the shopper last
 * spoke, or adds a new row when there are none. No cards adds nothing. The
 * ids now on screen wait in the log for the assistant's next line.
 */
export function addCardGroup<C extends { id: string }>(
  groups: CardGroup<C>[],
  log: CallLog,
  products: C[],
  source: "found" | "picked",
  at: number,
): { groups: CardGroup<C>[]; log: CallLog } {
  if (!products.length) return { groups, log };
  const shopperSpoke = Math.max(-Infinity, ...log.captions.filter((c) => c.speaker === "shopper").map((c) => c.at));
  let keep = groups.length;
  if (source === "picked") while (keep > 0 && groups[keep - 1]!.auto && groups[keep - 1]!.at > shopperSpoke) keep--;
  const replaced = new Set(groups.slice(keep).flatMap((g) => g.products.map((p) => p.id)));
  const ids = [...new Set([...log.pendingProductIds.filter((id) => !replaced.has(id)), ...products.map((p) => p.id)])];
  return {
    groups: [...groups.slice(0, keep), { at, products, auto: source === "found" }],
    log: { ...log, pendingProductIds: ids.slice(-MAX_SHOWN) },
  };
}

// Events the browser sends to the model on the data channel.

/** Hands skill answers back to the model and asks it to carry on. */
export const toolOutputEvents = (outputs: { callId: string; output: string }[]) => [
  ...outputs.map((o) => ({ type: "conversation.item.create", item: { type: "function_call_output", call_id: o.callId, output: o.output } })),
  { type: "response.create" },
];

/**
 * Puts typed text into the live call as the shopper's turn and asks for a
 * reply. While the model is mid-reply only the text is added (a second reply
 * request would be refused); the panel asks for the reply once it finishes.
 */
export const typedTextEvents = (text: string, responding: boolean) => [
  { type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } },
  ...(responding ? [] : [{ type: "response.create" }]),
];

export const TIME_WARNING = "The demo call ends in about 30 seconds. In one short sentence, tell the shopper time is nearly up.";

/** Asks the model to say time is nearly up; mid-reply, only the note is added, as for typed text. */
export const timeWarningEvents = (responding: boolean) => [
  { type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: TIME_WARNING }] } },
  ...(responding ? [] : [{ type: "response.create" }]),
];

// --- Talk panel -------------------------------------------------------------

/** The timer as m:ss, counting whole seconds up: 5:00, 0:30, 0:00. */
export function formatClock(remainingMs: number): string {
  const secs = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export const TIME_UP = "Demo time's up.";

const ANNOUNCE_AT = [30, 20, 10, 5];

/**
 * What the screen-reader countdown says with `remainingMs` left: a line at 30,
 * 20, 10 and 5 seconds and at zero, otherwise null (keep the last one), so it
 * isn't read out every second.
 */
export function countdownAnnouncement(remainingMs: number): string | null {
  const phase = timerPhase(remainingMs);
  if (phase === "over") return TIME_UP;
  const secs = Math.ceil(remainingMs / 1000);
  return phase === "final" && ANNOUNCE_AT.includes(secs) ? `${secs} seconds left in the call.` : null;
}

export type MicProblem = "blocked" | "unsupported";

export const MIC_MESSAGES: Record<MicProblem, string> = {
  blocked: "The microphone is blocked. Allow it in your browser settings to talk, or type your question instead.",
  unsupported: "Talk needs a microphone, and this browser or device can't provide one. Type your question instead.",
};

/** Whether this browser can make a call: microphone access and WebRTC. */
export function browserCanTalk(w: { navigator?: { mediaDevices?: { getUserMedia?: unknown } }; RTCPeerConnection?: unknown }): boolean {
  return typeof w.navigator?.mediaDevices?.getUserMedia === "function" && typeof w.RTCPeerConnection === "function";
}

/** Why the microphone failed: refused permission is "blocked"; no device or no support is "unsupported". */
export function micProblem(err: unknown): MicProblem {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  return name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError" ? "blocked" : "unsupported";
}

/** GET /api/voice/session as the panel sees it. */
export type TalkStatus =
  | { available: true }
  | { available: false; reason: "cooldown" | "locked"; availableAt: string }
  | { available: false; reason: "unavailable" };

/** Reads a session status (or refusal) reply, treating anything unexpected as unavailable. */
export function readTalkStatus(data: unknown): TalkStatus {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (d.available === true) return { available: true };
  if ((d.reason === "cooldown" || d.reason === "locked") && typeof d.availableAt === "string" && !Number.isNaN(Date.parse(d.availableAt))) {
    return { available: false, reason: d.reason, availableAt: d.availableAt };
  }
  return { available: false, reason: "unavailable" };
}

/** Where the call is: no call, code prompt open, connecting, live, or ended at 0:00. */
export type CallStage = "idle" | "prompt" | "connecting" | "live" | "over";

export type PanelView =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "prompt" }
  | { kind: "connecting" }
  | { kind: "live"; phase: "normal" | "final"; clock: string }
  | { kind: "over"; availableAt: Date | null }
  | { kind: "waiting"; reason: "cooldown" | "locked"; availableAt: Date }
  | { kind: "mic"; problem: MicProblem }
  | { kind: "unavailable" };

/**
 * Which Talk state the panel shows (`status` is null while it loads). A call in
 * progress comes first, and shows "over" the moment the timer reaches 0:00;
 * then a microphone problem, then the open code prompt, then the server's
 * status: available, resting or locked out until a time, unavailable, or
 * still checking. A wait that has run out shows Talk as ready again.
 */
export function voicePanelView(s: { status: TalkStatus | null; stage: CallStage; remainingMs: number; mic: MicProblem | null; now: number }): PanelView {
  const waiting = s.status && !s.status.available && s.status.reason !== "unavailable" ? s.status : null;
  const until = waiting && Date.parse(waiting.availableAt) > s.now ? new Date(waiting.availableAt) : null;
  if (s.stage === "live") {
    const phase = timerPhase(s.remainingMs);
    return phase === "over" ? { kind: "over", availableAt: until } : { kind: "live", phase, clock: formatClock(s.remainingMs) };
  }
  if (s.stage === "connecting") return { kind: "connecting" };
  if (s.stage === "over") return { kind: "over", availableAt: until };
  if (s.mic) return { kind: "mic", problem: s.mic };
  if (s.stage === "prompt") return { kind: "prompt" };
  if (!s.status) return { kind: "checking" };
  if (s.status.available) return { kind: "ready" };
  if (!waiting) return { kind: "unavailable" };
  return until ? { kind: "waiting", reason: waiting.reason, availableAt: until } : { kind: "ready" };
}

/** "3:45 PM", in the shopper's own clock unless a locale and time zone are given. */
export const formatAvailableAt = (at: Date, locale?: string, timeZone?: string) =>
  at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone });

/** The sentence the panel shows while Talk is resting or locked. */
export function waitMessage(reason: "cooldown" | "locked", at: Date, locale?: string, timeZone?: string): string {
  const when = formatAvailableAt(at, locale, timeZone);
  return reason === "locked"
    ? `Too many wrong codes. Talk is available again at ${when}.`
    : `Talk is resting after your last call. It's available again at ${when}.`;
}

// --- Transcript window --------------------------------------------------------

/** A transcript line as the window receives it: from the panel (time in ms) or from the store or its JSON (Date or ISO text). */
export type StoredLine = { speaker: Speaker; text: string; at: Date | string | number; productIds?: string[] };

export type ProductLink = { id: string; href: string; label: string };

/** One row of the transcript window. `dateTime` is ISO for <time>, or "" when the time is unreadable. */
export type TranscriptRow = { key: string; speaker: Speaker; label: string; time: string; dateTime: string; text: string; products: ProductLink[] };

export const SPEAKER_LABELS: Record<Speaker, string> = { shopper: "You", assistant: "Assistant" };
/** The owner reads other people's calls, so the shopper isn't "You" there. */
export const OWNER_SPEAKER_LABELS: Record<Speaker, string> = { shopper: "Shopper", assistant: "Assistant" };

/** "3:45:12 PM", in the shopper's own clock unless a locale and time zone are given. */
export const formatLineTime = (at: Date, locale?: string, timeZone?: string) =>
  at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone });

/**
 * Turns transcript lines into the window's rows, oldest first (lines with the
 * same time keep their order; an unreadable time goes last, with no time
 * shown). Each product id becomes a link to /p/[id], named from `names` when
 * the panel knows it, otherwise "Product 1", "Product 2" and so on.
 */
export function transcriptRows(
  lines: readonly StoredLine[],
  opts: { names?: Record<string, string>; labels?: Record<Speaker, string>; locale?: string; timeZone?: string } = {},
): TranscriptRow[] {
  const labels = opts.labels ?? SPEAKER_LABELS;
  const timed = lines.map((line, i) => {
    const at = new Date(line.at);
    return { line, i, ms: Number.isNaN(at.getTime()) ? Infinity : at.getTime(), at };
  });
  timed.sort((a, b) => (a.ms === b.ms ? a.i - b.i : a.ms - b.ms));
  return timed.map(({ line, i, ms, at }) => {
    const known = ms !== Infinity;
    return {
      key: `${i}-${known ? ms : "x"}`,
      speaker: line.speaker,
      label: labels[line.speaker] ?? line.speaker,
      time: known ? formatLineTime(at, opts.locale, opts.timeZone) : "",
      dateTime: known ? at.toISOString() : "",
      text: line.text,
      products: (line.productIds ?? []).map((id, n) => ({
        id,
        href: `/p/${encodeURIComponent(id)}`,
        label: opts.names?.[id] ?? `Product ${n + 1}`,
      })),
    };
  });
}

export const EMPTY_TRANSCRIPT_TEXT = "This call has no transcript lines.";

/** "2026-10-16-1530": the date and 24-hour time for a file name, in the shopper's own clock unless a time zone is given. */
function fileStamp(at: Date, timeZone?: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}`;
}

/**
 * The transcript as a plain text file, from the same rows as the window: one
 * "[time] Speaker: text" line each, in order, with the products shown listed
 * under their line as "name: full link" (`origin` is the site's address).
 * An empty transcript is a one-line message. The file name is dated from the
 * first line with a readable time, or `now`: machine-shop-call-2026-10-16-1530.txt.
 */
export function transcriptText(
  lines: readonly StoredLine[],
  opts: { origin: string; names?: Record<string, string>; labels?: Record<Speaker, string>; locale?: string; timeZone?: string; now?: Date },
): { text: string; fileName: string } {
  const rows = transcriptRows(lines, opts);
  const first = rows.find((r) => r.dateTime);
  const fileName = `machine-shop-call-${fileStamp(first ? new Date(first.dateTime) : (opts.now ?? new Date()), opts.timeZone)}.txt`;
  if (!rows.length) return { text: `${EMPTY_TRANSCRIPT_TEXT}\n`, fileName };
  const origin = opts.origin.replace(/\/+$/, "");
  const text = rows
    .map((r) => [`[${r.time || "time unknown"}] ${r.label}: ${r.text}`, ...r.products.map((p) => `    ${p.label}: ${origin}${p.href}`)].join("\n"))
    .join("\n");
  return { text: `${text}\n`, fileName };
}

// --- Owner view ---------------------------------------------------------------

/** How long the owner's sign-in cookie lasts. */
export const OWNER_SESSION_MS = 4 * HOUR;
/** Transcripts are kept (and listed) for 30 days. */
export const TRANSCRIPT_KEEP_MS = 30 * 24 * HOUR;
export const OWNER_PAGE_SIZE = 20;
const MAX_OWNER_PAGE = 1000;

/** The oldest transcript the owner list covers: exactly 30 days before `now`. */
export const transcriptsSince = (now: Date) => new Date(now.getTime() - TRANSCRIPT_KEEP_MS);

/** Whether a transcript created at `createdAt` is still inside the 30-day window (the TTL index can lag). */
export const withinKeep = (createdAt: Date, now: Date) => createdAt.getTime() >= transcriptsSince(now).getTime();

/** A page number from the query string: a whole number from 1 to 1000, otherwise 1. */
export function pageNumber(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_OWNER_PAGE) : 1;
}
