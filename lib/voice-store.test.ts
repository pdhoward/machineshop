import { createHmac } from "node:crypto";

import type { Db } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No real database. The catalog fails if anything calls it; MongoClient records the URI it was given.
const catalog = vi.hoisted(() => ({
  search: vi.fn(() => { throw new Error("catalog used"); }),
  product: vi.fn(() => { throw new Error("catalog used"); }),
  cardsByIds: vi.fn(() => { throw new Error("catalog used"); }),
}));
vi.mock("./catalog", () => catalog);

const mongo = vi.hoisted(() => ({ uris: [] as string[], dbNames: [] as string[] }));
vi.mock("mongodb", () => ({
  MongoClient: class {
    constructor(uri: string) { mongo.uris.push(uri); }
    async connect() {
      return { db: (name: string) => (mongo.dbNames.push(name), { databaseName: name }) };
    }
  },
}));

import { hashId, LIST_PAGE_SIZE, MAX_LIST_SIZE, TRANSCRIPT_TTL_SECONDS, voiceDb, voiceStore } from "./voice-store";
import { LOCKOUT_MS, MAX_MISSES, type TranscriptLine } from "./voice";

const T0 = new Date("2026-10-15T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const SECRET = "test-voice-secret";
const CALLER = { deviceId: "device-7f3a", ip: "203.0.113.9" };

// --- An in-memory stand-in for the few MongoDB calls the store makes -------

type Doc = Record<string, unknown>;

function fakeDb() {
  const data = new Map<string, Doc[]>();
  const indexes: { collection: string; keys: unknown; options: unknown }[] = [];
  const limits: number[] = [];
  const docs = (name: string) => data.get(name) ?? (data.set(name, []), data.get(name)!);
  const same = (a: unknown, b: unknown) =>
    a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : (a ?? null) === (b ?? null);
  const matches = (d: Doc, filter: Doc): boolean =>
    Object.entries(filter).every(([k, v]) => {
      if (k === "$or") return (v as Doc[]).some((sub) => matches(d, sub));
      if (v && typeof v === "object" && "$gte" in v) return (d[k] as Date) >= (v as { $gte: Date }).$gte;
      return same(d[k], v);
    });

  const collection = (name: string) => {
    const list = docs(name);
    return {
      async createIndex(keys: unknown, options: unknown) {
        indexes.push({ collection: name, keys, options });
        return "index";
      },
      async insertOne(doc: Doc) {
        list.push(structuredClone(doc));
        return { insertedId: doc._id };
      },
      async findOne(filter: Doc) {
        const d = list.find((x) => matches(x, filter));
        return d ? structuredClone(d) : null;
      },
      async updateOne(filter: Doc, update: Record<string, Doc>, options?: { upsert?: boolean }) {
        let d = list.find((x) => matches(x, filter));
        if (!d) {
          if (!options?.upsert) return { modifiedCount: 0 };
          d = { _id: filter._id, ...update.$setOnInsert };
          list.push(d);
        }
        Object.assign(d, structuredClone(update.$set ?? {}));
        for (const [field, push] of Object.entries(update.$push ?? {})) {
          const { $each, $slice } = push as { $each: unknown[]; $slice: number };
          d[field] = [...((d[field] as unknown[]) ?? []), ...structuredClone($each)].slice(0, $slice);
        }
        return { modifiedCount: 1 };
      },
      async deleteOne(filter: Doc) {
        const i = list.findIndex((x) => matches(x, filter));
        if (i >= 0) list.splice(i, 1);
      },
      async countDocuments(filter: Doc) {
        return list.filter((x) => matches(x, filter)).length;
      },
      find(filter: Doc, options?: { projection?: Record<string, 0> }) {
        let rows = list.filter((x) => matches(x, filter));
        const cursor = {
          sort(spec: Record<string, 1 | -1>) {
            const [key, dir] = Object.entries(spec)[0]!;
            rows = [...rows].sort((a, b) => ((a[key] as Date) > (b[key] as Date) ? dir : -dir));
            return cursor;
          },
          skip(n: number) { rows = rows.slice(n); return cursor; },
          limit(n: number) { limits.push(n); rows = rows.slice(0, n); return cursor; },
          async toArray() {
            const hidden = Object.keys(options?.projection ?? {});
            return rows.map((r) => Object.fromEntries(Object.entries(structuredClone(r)).filter(([k]) => !hidden.includes(k))));
          },
        };
        return cursor;
      },
    };
  };

  const db = { collection } as unknown as Db;
  return { db, data, indexes, limits, store: voiceStore(async () => db) };
}

const line = (text: string, ms = 0, productIds: string[] = []): TranscriptLine => ({ speaker: "shopper", text, at: at(ms), productIds });

beforeEach(() => {
  vi.stubEnv("VOICE_SECRET", SECRET);
  mongo.uris.length = 0;
  mongo.dbNames.length = 0;
  delete (globalThis as { voiceMongo?: unknown }).voiceMongo;
});
afterEach(() => vi.unstubAllEnvs());

// --- Tests -----------------------------------------------------------------

describe("connection", () => {
  it("refuses to run without VOICE_MONGODB_URI, even when the catalog's MONGODB_URI is set", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://catalog.test/");
    vi.stubEnv("VOICE_MONGODB_URI", "");
    vi.stubEnv("VOICE_MONGODB_DB", "voice_test");
    await expect(voiceDb()).rejects.toThrow("VOICE_MONGODB_URI is not set.");
    await expect(voiceStore().session("any")).rejects.toThrow("VOICE_MONGODB_URI is not set.");
    expect(mongo.uris).toEqual([]);
  });

  it("refuses to run without VOICE_MONGODB_DB rather than fall back to the catalog's database", async () => {
    vi.stubEnv("MONGODB_DB", "openai");
    vi.stubEnv("VOICE_MONGODB_URI", "mongodb://voice.test/");
    vi.stubEnv("VOICE_MONGODB_DB", "");
    await expect(voiceDb()).rejects.toThrow("VOICE_MONGODB_DB is not set.");
    expect(mongo.uris).toEqual([]);
  });

  it("refuses the catalog's own URI, which would mean sharing its login", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://catalog.test/");
    vi.stubEnv("VOICE_MONGODB_URI", "mongodb://catalog.test/");
    vi.stubEnv("VOICE_MONGODB_DB", "voice_test");
    await expect(voiceDb()).rejects.toThrow("must not be the catalog's MONGODB_URI");
    expect(mongo.uris).toEqual([]);
  });

  it("connects with VOICE_MONGODB_URI and VOICE_MONGODB_DB only", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://catalog.test/");
    vi.stubEnv("MONGODB_DB", "openai");
    vi.stubEnv("VOICE_MONGODB_URI", "mongodb://voice.test/");
    vi.stubEnv("VOICE_MONGODB_DB", "voice_test");
    await expect(voiceDb()).resolves.toEqual({ databaseName: "voice_test" });
    expect(mongo.uris).toEqual(["mongodb://voice.test/"]);
    expect(mongo.dbNames).toEqual(["voice_test"]);
  });
});

describe("TTL index", () => {
  it("creates a 30-day auto-delete index on the transcripts' created time, once", async () => {
    const { store, indexes } = fakeDb();
    await store.session("none");
    await store.transcript("none");
    expect(TRANSCRIPT_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(indexes).toEqual([{ collection: "transcripts", keys: { createdAt: 1 }, options: { expireAfterSeconds: 2_592_000 } }]);
  });
});

describe("hashed IDs", () => {
  const hmac = (raw: string) => createHmac("sha256", SECRET).update(raw).digest("hex");

  it("stores device and network IDs only as HMACs with VOICE_SECRET", async () => {
    const { store, data } = fakeDb();
    await store.startSession(CALLER, T0);
    await store.addMiss(CALLER.ip, T0);
    const [session] = data.get("sessions")!;
    expect(session!.deviceHash).toBe(hmac(CALLER.deviceId));
    expect(session!.networkHash).toBe(hmac(CALLER.ip));
    expect(data.get("attempts")![0]!._id).toBe(hmac(CALLER.ip));
    const everything = JSON.stringify([...data.values()]);
    expect(everything).not.toContain(CALLER.ip);
    expect(everything).not.toContain(CALLER.deviceId);
  });

  it("changes with the secret and refuses to hash without one", () => {
    expect(hashId(CALLER.ip, "other-secret")).not.toBe(hashId(CALLER.ip));
    vi.stubEnv("VOICE_SECRET", "");
    expect(() => hashId(CALLER.ip)).toThrow("VOICE_SECRET is not set.");
  });

  it("will not record a session without VOICE_SECRET", async () => {
    const { store, data } = fakeDb();
    vi.stubEnv("VOICE_SECRET", "");
    await expect(store.startSession(CALLER, T0)).rejects.toThrow("VOICE_SECRET is not set.");
    expect(data.get("sessions") ?? []).toEqual([]);
  });
});

describe("sessions", () => {
  it("round-trip with a 5-minute end time, and end once", async () => {
    const { store } = fakeDb();
    const s = await store.startSession(CALLER, T0);
    expect(s).toEqual({ id: expect.any(String), start: T0, endsAt: at(5 * MIN), endedAt: null });
    expect(await store.session(s.id)).toEqual(s);
    expect(await store.endSession(s.id, at(2 * MIN))).toBe(true);
    expect(await store.endSession(s.id, at(3 * MIN))).toBe(false);
    expect(await store.session(s.id)).toEqual({ ...s, endedAt: at(2 * MIN) });
    expect(await store.session("unknown")).toBeNull();
  });

  it("find the latest call start by device or by network, with a limited query", async () => {
    const { store, limits } = fakeDb();
    expect(await store.lastCallStart(CALLER)).toBeNull();
    await store.startSession(CALLER, T0);
    await store.startSession({ deviceId: "other-device", ip: CALLER.ip }, at(MIN));
    expect(await store.lastCallStart(CALLER)).toEqual(at(MIN));
    expect(await store.lastCallStart({ deviceId: CALLER.deviceId, ip: "198.51.100.1" })).toEqual(T0);
    expect(await store.lastCallStart({ deviceId: "stranger", ip: "198.51.100.1" })).toBeNull();
    expect(limits.every((n) => n === 1)).toBe(true);
  });
});

describe("attempts", () => {
  it("round-trip, lock out on the 5th miss, and clear", async () => {
    const { store } = fakeDb();
    expect(await store.attempts(CALLER.ip)).toBeNull();
    for (let i = 1; i < MAX_MISSES; i++) expect(await store.addMiss(CALLER.ip, T0)).toEqual({ count: i, lockedUntil: null });
    const locked = await store.addMiss(CALLER.ip, T0);
    expect(locked).toEqual({ count: MAX_MISSES, lockedUntil: at(LOCKOUT_MS) });
    expect(await store.attempts(CALLER.ip)).toEqual(locked);
    expect(await store.attempts(CALLER.deviceId)).toBeNull();
    await store.clearMisses(CALLER.ip);
    expect(await store.attempts(CALLER.ip)).toBeNull();
  });
});

describe("transcripts", () => {
  it("round-trip, appending lines in order and keeping the first created time", async () => {
    const { store } = fakeDb();
    const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
    await store.addLines("s1", [line("Do you have drills?"), { speaker: "assistant", text: "Yes, this one.", at: at(1000), productIds: [id] }], T0);
    await store.addLines("s1", [line("Thanks", 5000)], at(5000));
    await store.addLines("s1", [], at(9000));
    expect(await store.transcript("s1")).toEqual({
      sessionId: "s1",
      createdAt: T0,
      lines: [line("Do you have drills?"), { speaker: "assistant", text: "Yes, this one.", at: at(1000), productIds: [id] }, line("Thanks", 5000)],
    });
    expect(await store.transcript("s2")).toBeNull();
  });

  it("does not create a transcript for an empty batch", async () => {
    const { store } = fakeDb();
    await store.addLines("s1", [], T0);
    expect(await store.transcript("s1")).toBeNull();
  });

  it("list only those since the given time, newest first, without lines, paginated at 20", async () => {
    const { store, limits } = fakeDb();
    for (let i = 0; i < 25; i++) await store.addLines(`s${i}`, [line(`hi ${i}`)], at(i * MIN));
    await store.addLines("old", [line("old")], at(-31 * DAY));

    const first = await store.listTranscripts({ since: at(-30 * DAY) });
    expect(first.total).toBe(25);
    expect(first.items).toHaveLength(LIST_PAGE_SIZE);
    expect(first.items[0]).toEqual({ sessionId: "s24", createdAt: at(24 * MIN) });
    const second = await store.listTranscripts({ since: at(-30 * DAY), page: 2 });
    expect(second.items.map((t) => t.sessionId)).toEqual(["s4", "s3", "s2", "s1", "s0"]);
    expect(limits).toEqual([LIST_PAGE_SIZE, LIST_PAGE_SIZE]);
  });

  it("cap the page size however large a size is asked for", async () => {
    const { store, limits } = fakeDb();
    await store.listTranscripts({ since: T0, size: 10_000 });
    await store.listTranscripts({ since: T0, size: 0, page: -3 });
    expect(limits).toEqual([MAX_LIST_SIZE, 1]);
  });
});
