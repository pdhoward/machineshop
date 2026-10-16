"use client";

import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from "react";
import { Loader2, Mic, PhoneOff, ScrollText, X } from "lucide-react";

import type { ProductCard as Card } from "@/lib/product";
import {
  addCardGroup, applyCaption, browserCanTalk, CALL_MS, countdownAnnouncement, emptyCallLog, MAX_LINES, MIC_MESSAGES, micProblem, parseRealtimeEvent,
  readTalkStatus, REALTIME_CALLS_URL, TIME_UP, timerPhase, timeWarningEvents, toolOutputEvents, typedTextEvents, voicePanelView, waitMessage,
  type CallLog, type CallStage, type CaptionAction, type CardGroup, type MicProblem, type OutgoingLine, type TalkStatus, type ToolCall,
} from "@/lib/voice";

import { ProductCard } from "./product-card";
import { TranscriptModal } from "./transcript-modal";

/**
 * Talk mode in the assistant panel: the Talk button, the code prompt with the
 * transcription notice, and the live call. The browser talks to OpenAI
 * directly over WebRTC with the one-call pass from /api/voice/session, runs
 * the model's skill requests through /api/voice/tool, and saves finished
 * caption lines through /api/voice/transcript. Captions aren't drawn in the
 * panel, only product cards are; the transcript button opens the lines in
 * <TranscriptModal>, live during the call and after it. The
 * decisions live in lib/voice.ts; this file wires them to the browser.
 */

export type VoiceCallHandle = {
  /** Puts typed text into the live call. False when no call is live. */
  send: (text: string) => boolean;
};

type Call = { pc: RTCPeerConnection; dc: RTCDataChannel; mic: MediaStream };
type EndReason = "user" | "time" | "dropped";

const SNAG = "Talk hit a snag. Try again in a moment, or type your question.";
const DROPPED = "The call dropped. You can keep typing your questions.";

const stopTracks = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());

export function VoiceCall({
  ref,
  onLiveChange,
  onMicProblem,
}: {
  ref?: Ref<VoiceCallHandle>;
  onLiveChange: (live: boolean) => void;
  onMicProblem: () => void;
}) {
  const [status, setStatus] = useState<TalkStatus | null>(null);
  const [stage, setStage] = useState<CallStage>("idle");
  const [mic, setMic] = useState<MicProblem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [deadline, setDeadline] = useState(0);
  const [cards, setCards] = useState<CardGroup<Card>[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [lines, setLines] = useState<OutgoingLine[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const callRef = useRef<Call | null>(null);
  const tokenRef = useRef<string | null>(null);
  const deadlineRef = useRef(0);
  // Captions are collected here (and saved as lines), not drawn in the panel.
  const logRef = useRef<CallLog>(emptyCallLog());
  const cardsRef = useRef<CardGroup<Card>[]>(cards);
  const queueRef = useRef<OutgoingLine[]>([]);
  const flushingRef = useRef(false);
  const respondingRef = useRef(false);
  const replyPendingRef = useRef(false);
  const warnedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const talkRef = useRef<HTMLButtonElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const cardsStripRef = useRef<HTMLDivElement>(null);
  const focusTalkRef = useRef(false);

  const view = voicePanelView({ status, stage, remainingMs: deadline - now, mic, now });

  async function refreshStatus() {
    try {
      const res = await fetch("/api/voice/session", { cache: "no-store" });
      setStatus(readTalkStatus(await res.json().catch(() => null)));
    } catch {
      setStatus({ available: false, reason: "unavailable" });
    }
  }

  function sendEvents(events: object[]) {
    const dc = callRef.current?.dc;
    if (dc?.readyState === "open") for (const e of events) dc.send(JSON.stringify(e));
  }

  /** Posts finished lines in order, one request at a time; a failed post is dropped rather than retried. */
  async function flush() {
    const token = tokenRef.current;
    if (flushingRef.current || !token || !queueRef.current.length) return;
    flushingRef.current = true;
    const lines = queueRef.current.splice(0, MAX_LINES);
    try {
      await fetch("/api/voice/transcript", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ lines }),
        keepalive: true,
      });
    } catch {}
    flushingRef.current = false;
    if (queueRef.current.length) void flush();
  }

  function addCaption(a: CaptionAction) {
    const { log: next, line } = applyCaption(logRef.current, a, Date.now());
    logRef.current = next;
    if (line) {
      setLines((l) => [...l, line]);
      queueRef.current.push(line);
      void flush();
    }
  }

  function showCards(products: Card[], source: "found" | "picked") {
    const next = addCardGroup(cardsRef.current, logRef.current, products, source, Date.now());
    cardsRef.current = next.groups;
    logRef.current = next.log;
    setCards(next.groups);
    setNames((n) => ({ ...n, ...Object.fromEntries(products.map((p) => [p.id, p.name])) }));
  }

  async function runTools(calls: ToolCall[]) {
    const call = callRef.current;
    const token = tokenRef.current;
    if (!call || !token) return;
    let ended = false;
    const outputs = await Promise.all(
      calls.map(async (c) => {
        try {
          const res = await fetch("/api/voice/tool", {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ name: c.name, arguments: c.arguments }),
          });
          const data = (await res.json().catch(() => ({}))) as { output?: string; products?: Card[]; found?: Card[]; error?: string; reason?: string };
          if (data.reason === "ended") ended = true;
          if (data.products?.length) showCards(data.products, "picked");
          else if (data.found?.length) showCards(data.found, "found");
          return { callId: c.callId, output: data.output ?? JSON.stringify({ error: data.error ?? "That didn't work." }) };
        } catch {
          return { callId: c.callId, output: JSON.stringify({ error: "Couldn't reach the catalog." }) };
        }
      }),
    );
    if (callRef.current !== call) return;
    // The server refuses skills once the call passes 5:00.
    if (ended) return void hangUp("time");
    replyPendingRef.current = false;
    sendEvents(toolOutputEvents(outputs));
  }

  function onEvent(data: unknown) {
    const a = parseRealtimeEvent(data);
    if (!a) return;
    if (a.kind === "caption") addCaption(a);
    else if (a.kind === "response_started") respondingRef.current = true;
    else if (a.kind === "response_done") {
      respondingRef.current = false;
      if (a.calls.length) void runTools(a.calls);
      else if (replyPendingRef.current) {
        replyPendingRef.current = false;
        sendEvents([{ type: "response.create" }]);
      }
    } else console.warn("[voice]", a.message);
  }

  async function hangUp(reason: EndReason) {
    const call = callRef.current;
    if (!call) return;
    callRef.current = null;
    call.dc.close();
    call.pc.close();
    stopTracks(call.mic);
    if (audioRef.current) audioRef.current.srcObject = null;
    // Keep half-finished lines in the transcript.
    for (const c of [...logRef.current.captions]) {
      if (!c.final && c.text.trim()) addCaption({ kind: "caption", id: c.id, speaker: c.speaker, text: c.text, mode: "final" });
    }
    onLiveChange(false);
    setStage(reason === "time" ? "over" : "idle");
    if (reason === "time") setAnnouncement(TIME_UP);
    if (reason === "dropped") setNotice(DROPPED);
    stripRef.current?.focus();
    void flush();
    await fetch("/api/voice/session", { method: "DELETE", headers: { authorization: `Bearer ${tokenRef.current}` }, keepalive: true }).catch(() => {});
    await refreshStatus();
  }

  function micFailed(problem: MicProblem) {
    setMic(problem);
    setStage("idle");
    onMicProblem();
  }

  function openPrompt() {
    setMic(null);
    setNotice(null);
    setStage("prompt");
  }

  function cancelPrompt() {
    setCode("");
    setNotice(null);
    setStage("idle");
    focusTalkRef.current = true;
  }

  async function startCall(e: FormEvent) {
    e.preventDefault();
    if (stage !== "prompt" || !code.trim()) return;
    setNotice(null);
    if (!browserCanTalk(window)) return micFailed("unsupported");
    // Still inside the tap: let the audio element play later (iPhone Safari needs a gesture).
    const audio = audioRef.current;
    void audio?.play().catch(() => {});
    setStage("connecting");

    // The microphone first, so a blocked one doesn't use up the call.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      return micFailed(micProblem(err));
    }

    const sentAt = Date.now();
    let pass: string;
    try {
      const res = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => ({}))) as { pass?: unknown; token?: unknown; error?: string; reason?: string };
      if (!res.ok || typeof data.pass !== "string" || typeof data.token !== "string") {
        stopTracks(stream);
        setCode("");
        if (data.reason === "wrong_code") {
          setNotice(data.error ?? "That code isn't right.");
          setStage("prompt");
          codeRef.current?.focus();
          return;
        }
        if (data.reason === "locked" || data.reason === "cooldown") setStatus(readTalkStatus(data));
        else setNotice(data.error ?? SNAG);
        setStage("idle");
        return;
      }
      pass = data.pass;
      tokenRef.current = data.token;
    } catch {
      stopTracks(stream);
      setNotice(SNAG);
      setStage("idle");
      return;
    }

    setCode("");
    // Counted from when the request left, so the browser's 5:00 never runs past the server's.
    deadlineRef.current = sentAt + CALL_MS;
    setDeadline(deadlineRef.current);
    logRef.current = emptyCallLog();
    cardsRef.current = [];
    setCards([]);
    setLines([]);
    setNames({});
    setAnnouncement("");
    queueRef.current = [];
    respondingRef.current = false;
    replyPendingRef.current = false;
    warnedRef.current = false;

    const pc = new RTCPeerConnection();
    const dc = pc.createDataChannel("oai-events");
    callRef.current = { pc, dc, mic: stream };
    try {
      pc.ontrack = (ev) => {
        if (!audio) return;
        audio.srcObject = ev.streams[0] ?? new MediaStream([ev.track]);
        void audio.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") void hangUp("dropped");
      };
      for (const t of stream.getTracks()) pc.addTrack(t, stream);
      dc.onmessage = (ev) => onEvent(ev.data);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answer = await fetch(REALTIME_CALLS_URL, {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${pass}`, "Content-Type": "application/sdp" },
      });
      if (!answer.ok) throw new Error(`OpenAI answered ${answer.status}`);
      await pc.setRemoteDescription({ type: "answer", sdp: await answer.text() });
    } catch (err) {
      console.error("[voice]", err);
      await hangUp("user");
      setNotice(SNAG);
      return;
    }
    if (callRef.current?.pc !== pc) return;
    setNow(Date.now());
    setStage("live");
    onLiveChange(true);
  }

  useImperativeHandle(ref, () => ({
    send(text: string) {
      if (!callRef.current) return false;
      addCaption({ kind: "caption", id: `typed-${Date.now()}`, speaker: "shopper", text, mode: "final" });
      if (respondingRef.current) replyPendingRef.current = true;
      sendEvents(typedTextEvents(text, respondingRef.current));
      return true;
    },
  }));

  // Talk's status when the panel opens; hang up if the panel closes or the page goes away mid-call.
  useEffect(() => {
    void refreshStatus();
    const onLeave = () => void hangUp("user");
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      void hangUp("user");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once; the handlers read refs
  }, []);

  // The call timer: countdown announcements, the 30-second warning, and the hang-up at 0:00.
  useEffect(() => {
    if (stage !== "live") return;
    const tick = () => {
      const t = Date.now();
      const left = deadlineRef.current - t;
      setNow(t);
      const said = countdownAnnouncement(left);
      if (said) setAnnouncement(said);
      if (timerPhase(left) !== "normal" && !warnedRef.current) {
        warnedRef.current = true;
        if (respondingRef.current) replyPendingRef.current = true;
        sendEvents(timeWarningEvents(respondingRef.current));
      }
      if (left <= 0) void hangUp("time");
    };
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handlers read refs
  }, [stage]);

  // When a rest or lockout runs out, show Talk again.
  const waitUntil = view.kind === "waiting" ? view.availableAt.getTime() : null;
  useEffect(() => {
    if (waitUntil === null) return;
    const id = setTimeout(() => {
      setNow(Date.now());
      void refreshStatus();
    }, Math.min(Math.max(waitUntil - Date.now(), 0) + 1000, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [waitUntil]);

  useEffect(() => {
    if (view.kind === "prompt") codeRef.current?.focus();
    if (focusTalkRef.current && talkRef.current) {
      focusTalkRef.current = false;
      talkRef.current.focus();
    }
  }, [view.kind]);

  // Newest card group last: bring it into view as it arrives.
  useEffect(() => {
    cardsStripRef.current?.scrollTo({ left: cardsStripRef.current.scrollWidth, behavior: "smooth" });
  }, [cards]);

  const talkButton = (
    <button
      ref={talkRef}
      type="button"
      onClick={openPrompt}
      aria-label="Talk to the assistant"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-on-accent transition-colors hover:bg-accent-2"
    >
      <Mic className="size-4" /> Talk
    </button>
  );

  return (
    <div ref={stripRef} tabIndex={-1} className="flex flex-col gap-2 border-b border-line px-4 py-3 text-[13.5px] focus:outline-none">
      <audio ref={audioRef} autoPlay className="hidden" />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {view.kind === "checking" && (
        <p className="flex items-center gap-2 text-mist">
          <Loader2 className="size-4 animate-spin" /> Checking whether Talk is available…
        </p>
      )}

      {view.kind === "mic" && (
        <p role="alert" className="text-bad">
          {MIC_MESSAGES[view.problem]}
        </p>
      )}

      {(view.kind === "ready" || view.kind === "mic") && (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-fog">Rather talk it through? Try a 5-minute voice call.</p>
          {talkButton}
        </div>
      )}

      {view.kind === "prompt" && (
        <form
          onSubmit={startCall}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancelPrompt();
            }
          }}
          className="flex flex-col gap-2"
        >
          <p id="voice-notice">
            <strong>This call is transcribed.</strong> <span className="text-fog">Calls last up to 5 minutes, and the transcript is kept for 30 days.</span>
          </p>
          <label htmlFor="voice-code" className="text-[12px] text-mist">
            Access code
          </label>
          <div className="flex items-center gap-2">
            <input
              id="voice-code"
              ref={codeRef}
              type="password"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={200}
              aria-describedby="voice-notice"
              className="min-w-0 flex-1 rounded-2xl border border-line bg-bg px-3.5 py-2 placeholder:text-mist focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={!code.trim()}
              className="shrink-0 rounded-full bg-accent px-4 py-2 font-semibold text-on-accent transition-colors hover:bg-accent-2 disabled:opacity-40"
            >
              Start call
            </button>
            <button type="button" onClick={cancelPrompt} aria-label="Cancel call" className="rounded-full p-1.5 text-mist hover:bg-panel-2 hover:text-ink">
              <X className="size-4" />
            </button>
          </div>
        </form>
      )}

      {view.kind === "connecting" && (
        <p className="flex items-center gap-2 text-mist">
          <Loader2 className="size-4 animate-spin" /> Connecting… allow the microphone if your browser asks.
        </p>
      )}

      {view.kind === "live" && (
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 font-medium">
            <span aria-hidden className="size-2 animate-pulse rounded-full bg-good" /> Live
          </span>
          <span
            role="timer"
            aria-label={`Time left ${view.clock}`}
            className={view.phase === "final" ? "font-semibold tabular-nums text-bad" : "tabular-nums text-mist"}
          >
            {view.phase === "final" ? `${view.clock} left` : view.clock}
          </span>
          <button
            type="button"
            onClick={() => void hangUp("user")}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[13px] font-medium hover:border-bad hover:text-bad"
          >
            <PhoneOff className="size-4" /> Hang up
          </button>
        </div>
      )}

      {view.kind === "over" && (
        <p>
          <strong>{TIME_UP}</strong>
          {view.availableAt && <span className="text-fog"> {waitMessage("cooldown", view.availableAt)}</span>}
        </p>
      )}

      {view.kind === "waiting" && <p className="text-fog">{waitMessage(view.reason, view.availableAt)}</p>}

      {view.kind === "unavailable" && <p className="text-fog">Talk isn&apos;t available right now. You can still type your questions.</p>}

      {notice && (
        <p role="alert" className="text-bad">
          {notice}
        </p>
      )}

      {(stage === "live" || cards.length > 0 || lines.length > 0) && (
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-mist">Transcript</span>
          <button
            type="button"
            onClick={() => setTranscriptOpen(true)}
            aria-label="Open the call transcript"
            aria-haspopup="dialog"
            title="Transcript"
            className="rounded-full p-1.5 text-mist hover:bg-panel-2 hover:text-ink"
          >
            <ScrollText className="size-4" />
          </button>
        </div>
      )}

      {cards.length > 0 && (
        <div
          ref={cardsStripRef}
          role="region"
          aria-label="Products from this call"
          tabIndex={0}
          className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 focus:outline-none"
        >
          {cards.map((g, i) => (
            <div key={`cards-${i}`} className={`flex shrink-0 gap-2.5 ${i > 0 ? "border-l border-line pl-2.5" : ""}`}>
              {g.products.map((p) => (
                <div key={p.id} className="w-[150px] shrink-0">
                  <ProductCard p={p} compact />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <TranscriptModal open={transcriptOpen} onClose={() => setTranscriptOpen(false)} lines={lines} names={names} live={stage === "live"} />
    </div>
  );
}
