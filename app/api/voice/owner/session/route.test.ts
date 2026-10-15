import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Attempts } from "@/lib/voice";

// No real database: the voice store keeps wrong-code attempts in memory.
const fake = vi.hoisted(() => ({ attempts: new Map<string, Attempts>() }));

vi.mock("@/lib/voice-store", async () => {
  const { recordMiss } = await import("@/lib/voice");
  const store = {
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

import { LOCKOUT_MS, MAX_MISSES, OWNER_SESSION_MS } from "@/lib/voice";
import { verifyOwnerToken } from "@/lib/voice-token";

import { DELETE, POST } from "./route";

const T0 = new Date("2026-10-15T12:00:00.000Z");
const MIN = 60_000;
const SECRET = "test-voice-secret";
const OWNER_CODE = "test-owner-code";
const ACCESS_CODE = "test-access-code";
const DEVICE = "0b6f4c1e-3d2a-4f5b-9c8d-7e6f5a4b3c2d";
const IP = "203.0.113.9";

const ENV = {
  OPENAI_API_KEY: "sk-test-not-a-real-key-123",
  VOICE_MODEL: "gpt-realtime-test",
  VOICE_ACCESS_CODE: ACCESS_CODE,
  VOICE_OWNER_CODE: OWNER_CODE,
  VOICE_SECRET: SECRET,
  VOICE_MONGODB_URI: "mongodb://voice.test/fake",
  VOICE_MONGODB_DB: "voice_test",
};

function signIn(code: unknown, { device = DEVICE as string | null, ip = IP } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip };
  if (device) headers.cookie = `voice_device=${device}`;
  return POST(new Request("http://shop.test/api/voice/owner/session", { method: "POST", headers, body: JSON.stringify({ code }) }));
}

const ownerCookieOf = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith("voice_owner="));
const ownerTokenOf = (res: Response) => /^voice_owner=([^;]*)/.exec(ownerCookieOf(res) ?? "")?.[1];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  fake.attempts.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("owner sign-in", () => {
  it("returns 503 when Talk isn't configured", async () => {
    vi.stubEnv("VOICE_OWNER_CODE", "");
    const res = await signIn(OWNER_CODE);
    expect(res.status).toBe(503);
    expect(ownerCookieOf(res)).toBeUndefined();
  });

  it("sets a signed httpOnly owner cookie for 4 hours on the right code", async () => {
    const res = await signIn(OWNER_CODE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: true, expiresAt: new Date(T0.getTime() + OWNER_SESSION_MS).toISOString() });

    const cookie = ownerCookieOf(res)!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api/voice/owner");
    expect(cookie).toContain(`Max-Age=${OWNER_SESSION_MS / 1000}`);
    const token = ownerTokenOf(res)!;
    expect(verifyOwnerToken(token, T0, { secret: SECRET, code: OWNER_CODE })).toBe(true);
    expect(verifyOwnerToken(token, new Date(T0.getTime() + OWNER_SESSION_MS), { secret: SECRET, code: OWNER_CODE })).toBe(false);
    // The code itself never goes back to the browser.
    expect(cookie).not.toContain(OWNER_CODE);
  });

  it("refuses a wrong code, sets no cookie, and counts it against the device and the network", async () => {
    const res = await signIn("wrong-code");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "wrong_code" });
    expect(ownerCookieOf(res)).toBeUndefined();
    expect(fake.attempts.get(`device:${DEVICE}`)).toEqual({ count: 1, lockedUntil: null });
    expect(fake.attempts.get(`network:${IP}`)).toEqual({ count: 1, lockedUntil: null });
  });

  it("refuses the shoppers' access code and an empty or missing code, counting each", async () => {
    expect((await signIn(ACCESS_CODE)).status).toBe(403);
    expect((await signIn("")).status).toBe(403);
    expect((await signIn(undefined)).status).toBe(403);
    expect(fake.attempts.get(`device:${DEVICE}`)?.count).toBe(3);
  });

  it("counts toward the same lockout as Talk's access code, locking out on the 5th miss", async () => {
    // Four misses already made at Talk's code prompt (same device and network IDs).
    fake.attempts.set(`device:${DEVICE}`, { count: MAX_MISSES - 1, lockedUntil: null });
    const res = await signIn("wrong-code");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ reason: "locked", availableAt: new Date(T0.getTime() + LOCKOUT_MS).toISOString() });
    expect(ownerCookieOf(res)).toBeUndefined();
  });

  it("refuses a locked-out caller even with the right owner code, without counting", async () => {
    const lockedUntil = new Date(T0.getTime() + 20 * MIN);
    fake.attempts.set(`network:${IP}`, { count: MAX_MISSES, lockedUntil });
    const res = await signIn(OWNER_CODE, { device: null });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ reason: "locked", availableAt: lockedUntil.toISOString() });
    expect(ownerCookieOf(res)).toBeUndefined();
    expect(fake.attempts.get(`network:${IP}`)).toEqual({ count: MAX_MISSES, lockedUntil });
  });

  it("lets the owner in once the lockout lifts, and clears earlier misses", async () => {
    fake.attempts.set(`device:${DEVICE}`, { count: MAX_MISSES, lockedUntil: T0 });
    // The lifted lockout starts the count again.
    expect((await signIn("wrong-code")).status).toBe(403);
    const res = await signIn(OWNER_CODE);
    expect(res.status).toBe(200);
    expect(ownerTokenOf(res)).toBeTruthy();
    expect(fake.attempts.size).toBe(0);
  });

  it("keeps the device cookie so the lockout follows the browser", async () => {
    const res = await signIn("wrong-code", { device: null });
    const device = res.headers.getSetCookie().find((c) => c.startsWith("voice_device="));
    expect(device).toMatch(/^voice_device=[0-9a-f-]{36};/);
    expect(device).toContain("HttpOnly");
  });
});

describe("owner sign-out", () => {
  it("clears the owner cookie", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^voice_owner=; Path=\/api\/voice\/owner; Max-Age=0; HttpOnly/);
  });
});
