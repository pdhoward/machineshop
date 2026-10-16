import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Attempts } from "@/lib/voice";

// No real database or OpenAI: the catalog only reports it is connected, the voice store is in memory, fetch is stubbed.
vi.mock("@/lib/catalog", () => ({ catalogConfigured: () => true }));

type FakeSession = { id: string; deviceId: string; ip: string; start: Date; endsAt: Date; endedAt: Date | null };

const fake = vi.hoisted(() => ({
  sessions: [] as FakeSession[],
  attempts: new Map<string, Attempts>(),
}));

vi.mock("@/lib/voice-store", async () => {
  const { callEndsAt, recordMiss } = await import("@/lib/voice");
  const store = {
    async startSession(c: { deviceId: string; ip: string }, start: Date) {
      const s = { id: `session-${fake.sessions.length + 1}`, deviceId: c.deviceId, ip: c.ip, start, endsAt: callEndsAt(start), endedAt: null };
      fake.sessions.push(s);
      return { id: s.id, start: s.start, endsAt: s.endsAt, endedAt: s.endedAt };
    },
    async endSession(id: string, now: Date) {
      const s = fake.sessions.find((x) => x.id === id && !x.endedAt);
      if (s) s.endedAt = now;
      return !!s;
    },
    async lastCallStart(c: { deviceId: string; ip: string }) {
      const mine = fake.sessions.filter((s) => s.deviceId === c.deviceId || s.ip === c.ip);
      return mine.length ? new Date(Math.max(...mine.map((s) => s.start.getTime()))) : null;
    },
    async attempts(id: string) {
      return fake.attempts.get(id) ?? null;
    },
    async addMiss(id: string, now: Date) {
      const next = recordMiss(fake.attempts.get(id), now);
      fake.attempts.set(id, next);
      return next;
    },
    async clearMisses(id: string) {
      fake.attempts.delete(id);
    },
  };
  return { voiceStore: () => store };
});

import { buildSessionConfig, CALL_MS, LOCKOUT_MS, MAX_MISSES } from "@/lib/voice";
import { signSessionToken, verifySessionToken } from "@/lib/voice-token";

import { DELETE, GET, POST } from "./route";

const T0 = new Date("2026-10-15T12:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const OPENAI_KEY = "sk-test-not-a-real-key-123";
const CODE = "test-access-code";
const SECRET = "test-voice-secret";
const DEVICE = "0b6f4c1e-3d2a-4f5b-9c8d-7e6f5a4b3c2d";
const IP = "203.0.113.9";
const PASS = "ek_test_pass_abc";

const ENV = {
  OPENAI_API_KEY: OPENAI_KEY,
  VOICE_MODEL: "gpt-realtime-test",
  VOICE_ACCESS_CODE: CODE,
  VOICE_OWNER_CODE: "test-owner-code",
  VOICE_SECRET: SECRET,
  VOICE_MONGODB_URI: "mongodb://voice.test/fake",
  VOICE_MONGODB_DB: "voice_test",
};

const openai = vi.fn(async (_url: string, _init?: RequestInit) =>
  Response.json({ value: PASS, expires_at: T0.getTime() / 1000 + 60, session: { type: "realtime" } }),
);

function req(method: string, { body, device = DEVICE, ip = IP, token }: { body?: unknown; device?: string | null; ip?: string; token?: string } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": `${ip}, 10.0.0.1` };
  if (device) headers.cookie = `theme=dark; voice_device=${device}`;
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request("http://shop.test/api/voice/session", { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const start = (code: string, opts: { device?: string | null; ip?: string } = {}) => POST(req("POST", { body: { code }, ...opts }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.stubGlobal("fetch", openai);
  fake.sessions.length = 0;
  fake.attempts.clear();
  openai.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("configuration", () => {
  it.each(Object.keys(ENV))("returns 503 from status, start and end when %s is unset", async (key) => {
    vi.stubEnv(key, "");
    const token = signSessionToken({ sessionId: "session-1", endsAt: new Date(T0.getTime() + CALL_MS) }, SECRET);
    for (const res of [await GET(req("GET")), await start(CODE), await DELETE(req("DELETE", { token }))]) {
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ available: false });
    }
    expect(openai).not.toHaveBeenCalled();
    expect(fake.sessions).toHaveLength(0);
  });
});

describe("POST start", () => {
  it("refuses a wrong code and counts it against the device and the network", async () => {
    const res = await start("wrong-code");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "wrong_code" });
    expect(fake.attempts.get(`device:${DEVICE}`)).toEqual({ count: 1, lockedUntil: null });
    expect(fake.attempts.get(`network:${IP}`)).toEqual({ count: 1, lockedUntil: null });
    expect(openai).not.toHaveBeenCalled();
    expect(fake.sessions).toHaveLength(0);
  });

  it("refuses an empty or missing code and counts it", async () => {
    expect((await start("")).status).toBe(403);
    expect((await POST(req("POST", { body: {} }))).status).toBe(403);
    expect(fake.attempts.get(`device:${DEVICE}`)?.count).toBe(2);
  });

  it("locks the caller out for an hour on the 5th wrong code", async () => {
    for (let i = 1; i < MAX_MISSES; i++) expect((await start("wrong")).status).toBe(403);
    const res = await start("wrong");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ reason: "locked", availableAt: new Date(T0.getTime() + LOCKOUT_MS).toISOString() });
  });

  it("refuses a locked-out caller even with the right code, without counting or calling OpenAI", async () => {
    const lockedUntil = new Date(T0.getTime() + 20 * MIN);
    fake.attempts.set(`device:${DEVICE}`, { count: MAX_MISSES, lockedUntil });
    const res = await start(CODE);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ reason: "locked", availableAt: lockedUntil.toISOString() });
    expect(fake.attempts.get(`device:${DEVICE}`)).toEqual({ count: MAX_MISSES, lockedUntil });
    expect(openai).not.toHaveBeenCalled();
    expect(fake.sessions).toHaveLength(0);
  });

  it("keeps a locked-out network locked out after the cookie is cleared", async () => {
    fake.attempts.set(`network:${IP}`, { count: MAX_MISSES, lockedUntil: new Date(T0.getTime() + HOUR) });
    const res = await start(CODE, { device: null });
    expect(res.status).toBe(429);
    expect(openai).not.toHaveBeenCalled();
  });

  it("lets the caller in once the lockout lifts", async () => {
    fake.attempts.set(`device:${DEVICE}`, { count: MAX_MISSES, lockedUntil: T0 });
    expect((await start(CODE)).status).toBe(200);
  });

  it("checks the code right after a recent call, and lockout still wins", async () => {
    fake.sessions.push({ id: "old", deviceId: DEVICE, ip: IP, start: new Date(T0.getTime() - MIN), endsAt: new Date(T0.getTime() + 4 * MIN), endedAt: T0 });
    // No wait after a call: a wrong code is checked and counted toward lockout.
    const wrong = await start("wrong");
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ reason: "wrong_code" });
    expect(fake.attempts.get(`device:${DEVICE}`)).toEqual({ count: 1, lockedUntil: null });
    expect(fake.attempts.get(`network:${IP}`)).toEqual({ count: 1, lockedUntil: null });
    // The right code starts a call.
    expect((await start(CODE)).status).toBe(200);
    // Locked out after a recent call: lockout wins.
    fake.attempts.set(`network:${IP}`, { count: MAX_MISSES, lockedUntil: new Date(T0.getTime() + HOUR) });
    expect(await (await start(CODE)).json()).toMatchObject({ reason: "locked" });
  });

  it("allows back-to-back calls from the same device and network", async () => {
    expect((await start(CODE)).status).toBe(200);
    expect((await start(CODE)).status).toBe(200);
    expect(fake.sessions).toHaveLength(2);
    expect(fake.sessions.map((s) => [s.deviceId, s.ip])).toEqual([[DEVICE, IP], [DEVICE, IP]]);
    expect(openai).toHaveBeenCalledTimes(2);
  });

  it("still caps each call at 5 minutes from its own start", async () => {
    await start(CODE);
    const secondStart = new Date(T0.getTime() + CALL_MS);
    vi.setSystemTime(secondStart);
    const body = await (await start(CODE)).json();
    const endsAt = new Date(secondStart.getTime() + CALL_MS);
    expect(body.endsAt).toBe(endsAt.toISOString());
    expect(verifySessionToken(body.token, SECRET)).toEqual({ sessionId: "session-2", endsAt });
    expect(fake.sessions[1]).toMatchObject({ start: secondStart, endsAt });
  });

  it("returns a pass, the end time and a signed token, and never the OpenAI key", async () => {
    const res = await start(CODE);
    const text = await res.clone().text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(OPENAI_KEY);
    expect(text).not.toContain(SECRET);

    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["endsAt", "pass", "passExpiresAt", "token"]);
    expect(body.pass).toBe(PASS);
    expect(body.endsAt).toBe(new Date(T0.getTime() + CALL_MS).toISOString());
    expect(body.passExpiresAt).toBe(new Date(T0.getTime() + 60_000).toISOString());
    expect(verifySessionToken(body.token, SECRET)).toEqual({ sessionId: "session-1", endsAt: new Date(T0.getTime() + CALL_MS) });

    // The call is recorded for this device and network.
    expect(fake.sessions).toEqual([expect.objectContaining({ id: "session-1", deviceId: DEVICE, ip: IP, start: T0 })]);
  });

  it("asks OpenAI for the pass with the key, server side, using buildSessionConfig", async () => {
    await start(CODE);
    expect(openai).toHaveBeenCalledTimes(1);
    const [url, init] = openai.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${OPENAI_KEY}`);
    const sent = JSON.parse(init?.body as string);
    expect(sent.session).toEqual(JSON.parse(JSON.stringify(buildSessionConfig("gpt-realtime-test"))));
    expect(sent.expires_after).toEqual({ anchor: "created_at", seconds: 60 });
  });

  it("clears earlier wrong codes after the right one", async () => {
    await start("wrong");
    expect((await start(CODE)).status).toBe(200);
    expect(fake.attempts.size).toBe(0);
  });

  it("returns 502 and records no call when OpenAI refuses the pass", async () => {
    openai.mockResolvedValueOnce(Response.json({ error: { message: "nope" } }, { status: 500 }));
    const res = await start(CODE);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain(OPENAI_KEY);
    expect(fake.sessions).toHaveLength(0);
  });
});

describe("device cookie", () => {
  it("sets a new httpOnly device ID when there is none, and uses it for the call", async () => {
    const res = await start(CODE, { device: null });
    const cookie = res.headers.get("set-cookie") ?? "";
    const id = /voice_device=([^;]+)/.exec(cookie)?.[1];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(fake.sessions[0]?.deviceId).toBe(id);
  });

  it("keeps an existing device ID and replaces a malformed one", async () => {
    expect((await GET(req("GET"))).headers.get("set-cookie")).toContain(`voice_device=${DEVICE};`);
    const res = await GET(req("GET", { device: "not-a-uuid" }));
    expect(res.headers.get("set-cookie")).not.toContain("not-a-uuid");
  });
});

describe("GET status", () => {
  it("reports Talk available for a new caller", async () => {
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true });
  });

  it("reports Talk available right after a call starts and again after it ends", async () => {
    const { token } = await (await start(CODE)).json();
    expect(await (await GET(req("GET"))).json()).toEqual({ available: true });
    vi.setSystemTime(new Date(T0.getTime() + 2 * MIN));
    await DELETE(req("DELETE", { token }));
    expect(await (await GET(req("GET"))).json()).toEqual({ available: true });
  });

  it("reports when Talk will be available during a lockout", async () => {
    const lockedUntil = new Date(T0.getTime() + 30 * MIN);
    fake.attempts.set(`network:${IP}`, { count: MAX_MISSES, lockedUntil });
    expect(await (await GET(req("GET"))).json()).toEqual({ available: false, reason: "locked", availableAt: lockedUntil.toISOString() });
  });
});

describe("DELETE end", () => {
  it("marks the call ended", async () => {
    const { token } = await (await start(CODE)).json();
    vi.setSystemTime(new Date(T0.getTime() + 2 * MIN));
    const res = await DELETE(req("DELETE", { token }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ended: true });
    expect(fake.sessions[0]?.endedAt).toEqual(new Date(T0.getTime() + 2 * MIN));
    // Ending twice changes nothing.
    expect(await (await DELETE(req("DELETE", { token }))).json()).toEqual({ ended: false });
  });

  it("refuses a missing or forged token", async () => {
    await start(CODE);
    const endsAt = new Date(T0.getTime() + CALL_MS);
    const forged = signSessionToken({ sessionId: "session-1", endsAt }, "someone-elses-secret");
    expect((await DELETE(req("DELETE"))).status).toBe(401);
    expect((await DELETE(req("DELETE", { token: forged }))).status).toBe(401);
    expect((await DELETE(req("DELETE", { token: "session-1.123.abc" }))).status).toBe(401);
    expect(fake.sessions[0]?.endedAt).toBeNull();
  });
});
