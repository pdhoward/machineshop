import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptLine } from "@/lib/voice";

// No real database: the voice store's list and transcript reads are mocked.
type FakeTranscript = { sessionId: string; createdAt: Date; lines: TranscriptLine[] };
const fake = vi.hoisted(() => ({ transcripts: [] as FakeTranscript[] }));

const store = vi.hoisted(() => ({
  listTranscripts: vi.fn(async ({ since, page = 1, size = 20 }: { since: Date; page?: number; size?: number }) => {
    const kept = fake.transcripts.filter((t) => t.createdAt >= since).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const items = kept.slice((page - 1) * size, page * size).map((t) => ({ sessionId: t.sessionId, createdAt: t.createdAt }));
    return { items, total: kept.length };
  }),
  transcript: vi.fn(async (id: string) => fake.transcripts.find((t) => t.sessionId === id) ?? null),
}));
vi.mock("@/lib/voice-store", () => ({ voiceStore: () => store }));

import { OWNER_PAGE_SIZE, OWNER_SESSION_MS, TRANSCRIPT_KEEP_MS } from "@/lib/voice";
import { signOwnerToken } from "@/lib/voice-token";

import { GET as getCall } from "./[id]/route";
import { GET as list } from "./route";

const T0 = new Date("2026-10-15T12:00:00.000Z");
const MIN = 60_000;
const SECRET = "test-voice-secret";
const OWNER_CODE = "test-owner-code";

const ENV = {
  OPENAI_API_KEY: "sk-test-not-a-real-key-123",
  VOICE_MODEL: "gpt-realtime-test",
  VOICE_ACCESS_CODE: "test-access-code",
  VOICE_OWNER_CODE: OWNER_CODE,
  VOICE_SECRET: SECRET,
  VOICE_MONGODB_URI: "mongodb://voice.test/fake",
  VOICE_MONGODB_DB: "voice_test",
};

const KEYS = { secret: SECRET, code: OWNER_CODE };
const VALID = signOwnerToken(new Date(T0.getTime() + OWNER_SESSION_MS), KEYS);

function req(path: string, cookie: string | null = `voice_owner=${VALID}`) {
  return new Request(`http://shop.test${path}`, { headers: cookie ? { cookie } : {} });
}
const listPage = (query = "", cookie?: string | null) => list(req(`/api/voice/owner/transcripts${query}`, cookie));
const openCall = (id: string, cookie?: string | null) =>
  getCall(req(`/api/voice/owner/transcripts/${id}`, cookie), { params: Promise.resolve({ id }) });

const line = (text: string): TranscriptLine => ({ speaker: "shopper", text, at: T0, productIds: [] });
const call = (n: number, ageMs: number): FakeTranscript => ({ sessionId: `call-${n}`, createdAt: new Date(T0.getTime() - ageMs), lines: [line(`Call ${n}`)] });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.clearAllMocks();
  fake.transcripts.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("owner cookie", () => {
  const refusals: [string, string | null][] = [
    ["no cookie", null],
    ["an empty cookie", "voice_owner="],
    ["a forged cookie", `voice_owner=${signOwnerToken(new Date(T0.getTime() + OWNER_SESSION_MS), { secret: "someone-elses-secret", code: OWNER_CODE })}`],
    ["a cookie from an old owner code", `voice_owner=${signOwnerToken(new Date(T0.getTime() + OWNER_SESSION_MS), { secret: SECRET, code: "old-owner-code" })}`],
    ["an expired cookie", `voice_owner=${signOwnerToken(T0, KEYS)}`],
    ["a stretched cookie", `voice_owner=${VALID.replace(/^owner\.\d+/, `owner.${T0.getTime() + 100 * OWNER_SESSION_MS}`)}`],
    ["a shopper's session token", `voice_owner=session-1.${T0.getTime() + MIN}.abc`],
  ];

  it.each(refusals)("refuses the list with %s, without reading the store", async (_, cookie) => {
    const res = await listPage("", cookie);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ reason: "signed_out" });
    expect(store.listTranscripts).not.toHaveBeenCalled();
  });

  it.each(refusals)("refuses one call with %s, without reading the store", async (_, cookie) => {
    fake.transcripts.push(call(1, MIN));
    expect((await openCall("call-1", cookie)).status).toBe(401);
    expect(store.transcript).not.toHaveBeenCalled();
  });

  it("returns 503 when Talk isn't configured", async () => {
    vi.stubEnv("VOICE_SECRET", "");
    expect((await listPage()).status).toBe(503);
    expect((await openCall("call-1")).status).toBe(503);
  });
});

describe("owner list", () => {
  it("queries only the last 30 days", async () => {
    fake.transcripts.push(call(1, MIN), call(2, TRANSCRIPT_KEEP_MS - MIN), call(3, TRANSCRIPT_KEEP_MS + MIN));
    const res = await listPage();
    expect(res.status).toBe(200);
    expect(store.listTranscripts).toHaveBeenCalledWith({ since: new Date(T0.getTime() - TRANSCRIPT_KEEP_MS), page: 1, size: 20 });
    const body = await res.json();
    expect(body.items.map((i: { sessionId: string }) => i.sessionId)).toEqual(["call-1", "call-2"]);
    expect(body.total).toBe(2);
  });

  it("paginates at 20, newest first", async () => {
    expect(OWNER_PAGE_SIZE).toBe(20);
    for (let n = 1; n <= 45; n++) fake.transcripts.push(call(n, n * MIN));

    const first = await (await listPage()).json();
    expect(first).toMatchObject({ total: 45, page: 1, pageSize: 20, pages: 3 });
    expect(first.items).toHaveLength(20);
    expect(first.items[0]).toEqual({ sessionId: "call-1", createdAt: new Date(T0.getTime() - MIN).toISOString() });

    const third = await (await listPage("?page=3")).json();
    expect(third).toMatchObject({ page: 3, pages: 3 });
    expect(third.items.map((i: { sessionId: string }) => i.sessionId)).toEqual(["call-41", "call-42", "call-43", "call-44", "call-45"]);
    expect(store.listTranscripts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3, size: 20 }));
  });

  it("treats a missing or junk page as page 1", async () => {
    for (const q of ["", "?page=0", "?page=-2", "?page=abc", "?page=1.5"]) await listPage(q);
    for (const [arg] of store.listTranscripts.mock.calls) expect(arg).toMatchObject({ page: 1, size: 20 });
  });

  it("returns no transcript lines in the list", async () => {
    fake.transcripts.push(call(1, MIN));
    const text = await (await listPage()).text();
    expect(text).not.toContain("Call 1");
  });

  it("returns an empty first page when nothing is saved", async () => {
    expect(await (await listPage()).json()).toEqual({ items: [], total: 0, page: 1, pageSize: 20, pages: 1 });
  });

  it("returns 502 when the store fails", async () => {
    store.listTranscripts.mockRejectedValueOnce(new Error("down"));
    expect((await listPage()).status).toBe(502);
  });
});

describe("owner call", () => {
  it("returns one saved call's lines for the transcript window", async () => {
    fake.transcripts.push(call(1, MIN));
    const res = await openCall("call-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sessionId: "call-1",
      createdAt: new Date(T0.getTime() - MIN).toISOString(),
      lines: [{ speaker: "shopper", text: "Call 1", at: T0.toISOString(), productIds: [] }],
    });
  });

  it("returns 404 for an unknown call or one older than 30 days, even if not yet auto-deleted", async () => {
    fake.transcripts.push(call(1, TRANSCRIPT_KEEP_MS + MIN));
    expect((await openCall("call-1")).status).toBe(404);
    expect((await openCall("nope")).status).toBe(404);
  });
});
