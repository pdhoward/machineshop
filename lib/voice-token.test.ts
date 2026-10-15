import { afterEach, describe, expect, it, vi } from "vitest";

import { bearerToken, cookieValue, signOwnerToken, signSessionToken, verifyOwnerToken, verifySessionToken } from "./voice-token";

const SECRET = "test-voice-secret";
const CLAIM = { sessionId: "2c1d7a4e-0f3b-4a5c-8d9e-1f2a3b4c5d6e", endsAt: new Date("2026-10-15T12:05:00.000Z") };

afterEach(() => vi.unstubAllEnvs());

describe("session tokens", () => {
  it("round-trips the session ID and end time", () => {
    expect(verifySessionToken(signSessionToken(CLAIM, SECRET), SECRET)).toEqual(CLAIM);
  });

  it("uses VOICE_SECRET by default and refuses to sign without it", () => {
    vi.stubEnv("VOICE_SECRET", SECRET);
    expect(verifySessionToken(signSessionToken(CLAIM))).toEqual(CLAIM);
    vi.stubEnv("VOICE_SECRET", "");
    expect(() => signSessionToken(CLAIM)).toThrow(/VOICE_SECRET/);
    expect(verifySessionToken(signSessionToken(CLAIM, SECRET))).toBeNull();
  });

  it("refuses tokens signed with another secret", () => {
    expect(verifySessionToken(signSessionToken(CLAIM, "other-secret"), SECRET)).toBeNull();
  });

  it("refuses a token whose session or end time was changed", () => {
    const [id, ms, sig] = signSessionToken(CLAIM, SECRET).split(".");
    expect(verifySessionToken(`${id}.${Number(ms) + 60_000}.${sig}`, SECRET)).toBeNull();
    expect(verifySessionToken(`other-session.${ms}.${sig}`, SECRET)).toBeNull();
  });

  it("refuses missing, malformed and oversized tokens", () => {
    for (const t of [null, undefined, "", "abc", "a.b", "a.b.c.d", `${"x".repeat(300)}.1.sig`]) {
      expect(verifySessionToken(t, SECRET)).toBeNull();
    }
  });
});

describe("owner tokens", () => {
  const KEYS = { secret: SECRET, code: "test-owner-code" };
  const NOW = new Date("2026-10-15T12:00:00.000Z");
  const EXPIRES = new Date("2026-10-15T16:00:00.000Z");

  it("is valid until it expires", () => {
    const token = signOwnerToken(EXPIRES, KEYS);
    expect(verifyOwnerToken(token, NOW, KEYS)).toBe(true);
    expect(verifyOwnerToken(token, new Date(EXPIRES.getTime() - 1), KEYS)).toBe(true);
    expect(verifyOwnerToken(token, EXPIRES, KEYS)).toBe(false);
  });

  it("uses VOICE_SECRET and VOICE_OWNER_CODE by default and refuses to sign without them", () => {
    vi.stubEnv("VOICE_SECRET", SECRET);
    vi.stubEnv("VOICE_OWNER_CODE", KEYS.code);
    expect(verifyOwnerToken(signOwnerToken(EXPIRES), NOW)).toBe(true);
    vi.stubEnv("VOICE_OWNER_CODE", "");
    expect(() => signOwnerToken(EXPIRES)).toThrow(/VOICE_OWNER_CODE/);
    expect(verifyOwnerToken(signOwnerToken(EXPIRES, KEYS), NOW)).toBe(false);
    vi.stubEnv("VOICE_SECRET", "");
    expect(() => signOwnerToken(EXPIRES, { code: KEYS.code })).toThrow(/VOICE_SECRET/);
  });

  it("refuses a token signed with another secret or an old owner code", () => {
    expect(verifyOwnerToken(signOwnerToken(EXPIRES, { ...KEYS, secret: "other-secret" }), NOW, KEYS)).toBe(false);
    expect(verifyOwnerToken(signOwnerToken(EXPIRES, { ...KEYS, code: "old-code" }), NOW, KEYS)).toBe(false);
  });

  it("refuses a stretched expiry, a session token, and malformed tokens", () => {
    const [, ms, sig] = signOwnerToken(EXPIRES, KEYS).split(".");
    expect(verifyOwnerToken(`owner.${Number(ms) + 60_000}.${sig}`, NOW, KEYS)).toBe(false);
    expect(verifyOwnerToken(signSessionToken({ sessionId: "owner", endsAt: EXPIRES }, SECRET), NOW, KEYS)).toBe(false);
    for (const t of [null, undefined, "", "owner", "owner.1", `owner.abc.${sig}`, `owner.${ms}.${sig}.x`, `x${"y".repeat(300)}`]) {
      expect(verifyOwnerToken(t, NOW, KEYS)).toBe(false);
    }
  });
});

describe("cookieValue", () => {
  it("reads one cookie by name", () => {
    const r = new Request("http://shop.test/", { headers: { cookie: "theme=dark; voice_owner=owner.1.sig; voice_ownerx=no" } });
    expect(cookieValue(r, "voice_owner")).toBe("owner.1.sig");
    expect(cookieValue(r, "missing")).toBeNull();
    expect(cookieValue(new Request("http://shop.test/"), "voice_owner")).toBeNull();
  });
});

describe("bearerToken", () => {
  const withAuth = (value?: string) =>
    new Request("http://shop.test/", value === undefined ? {} : { headers: { authorization: value } });

  it("reads a Bearer token and ignores anything else", () => {
    expect(bearerToken(withAuth("Bearer abc.123.sig"))).toBe("abc.123.sig");
    expect(bearerToken(withAuth())).toBeNull();
    expect(bearerToken(withAuth("Basic abc"))).toBeNull();
  });
});
