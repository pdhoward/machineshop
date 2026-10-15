import { afterEach, describe, expect, it, vi } from "vitest";

import { bearerToken, signSessionToken, verifySessionToken } from "./voice-token";

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

describe("bearerToken", () => {
  const withAuth = (value?: string) =>
    new Request("http://shop.test/", value === undefined ? {} : { headers: { authorization: value } });

  it("reads a Bearer token and ignores anything else", () => {
    expect(bearerToken(withAuth("Bearer abc.123.sig"))).toBe("abc.123.sig");
    expect(bearerToken(withAuth())).toBeNull();
    expect(bearerToken(withAuth("Basic abc"))).toBeNull();
  });
});
