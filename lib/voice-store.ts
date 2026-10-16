import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import { MongoClient, type Db } from "mongodb";

import { callEndsAt, recordMiss, type Attempts, type TranscriptLine } from "./voice";

/**
 * The voice database: the only code that touches it, and the only code in the
 * site that writes anywhere. It connects with VOICE_MONGODB_URI and
 * VOICE_MONGODB_DB only, never the catalog's MONGODB_URI. It keeps call
 * sessions, wrong-code attempts and transcripts; transcripts delete themselves
 * after 30 days. Device and network IDs are stored only as HMACs with
 * VOICE_SECRET, never raw.
 */

export const TRANSCRIPT_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Most lines one call's transcript keeps. */
export const MAX_TRANSCRIPT_LINES = 500;
export const LIST_PAGE_SIZE = 20;
export const MAX_LIST_SIZE = 50;

type SessionDoc = { _id: string; deviceHash: string; networkHash: string; start: Date; endsAt: Date; endedAt: Date | null };
type AttemptsDoc = { _id: string; count: number; lockedUntil: Date | null; updatedAt: Date };
type TranscriptDoc = { _id: string; lines: TranscriptLine[]; createdAt: Date };

export type VoiceSession = { id: string; start: Date; endsAt: Date; endedAt: Date | null };
/** Who is calling: the device ID from the cookie and the network (IP) address. Hashed before storage. */
export type Caller = { deviceId: string; ip: string };
export type Transcript = { sessionId: string; createdAt: Date; lines: TranscriptLine[] };

// --- Connection -------------------------------------------------------------

// One client per server process (kept across hot reloads in dev), separate from the catalog's.
const g = globalThis as unknown as { voiceMongo?: Promise<MongoClient> };

/** The voice database. Refuses to run without its own settings, and never falls back to the catalog's. */
export async function voiceDb(): Promise<Db> {
  const uri = process.env.VOICE_MONGODB_URI;
  const name = process.env.VOICE_MONGODB_DB;
  if (!uri) throw new Error("VOICE_MONGODB_URI is not set.");
  if (!name) throw new Error("VOICE_MONGODB_DB is not set.");
  // Same URI means the same login; the voice database must have its own, which can write only there.
  if (uri === process.env.MONGODB_URI) throw new Error("VOICE_MONGODB_URI must not be the catalog's MONGODB_URI.");
  if (!g.voiceMongo) {
    const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 });
    // Share an in-flight attempt, but never pin a rejected promise for the process lifetime.
    const pending = client.connect().catch(async (error: unknown) => {
      if (g.voiceMongo === pending) delete g.voiceMongo;
      await client.close().catch(() => undefined);
      throw error;
    });
    g.voiceMongo = pending;
  }
  const client = await g.voiceMongo;
  return client.db(name);
}

// --- Hashing ----------------------------------------------------------------

/** HMAC-SHA256 of an ID with VOICE_SECRET, so stored device and network IDs can be matched but not read back. */
export function hashId(raw: string, secret = process.env.VOICE_SECRET): string {
  if (!secret) throw new Error("VOICE_SECRET is not set.");
  return createHmac("sha256", secret).update(raw).digest("hex");
}

// --- Store ------------------------------------------------------------------

// The TTL index is created once per database per process.
const indexed = new WeakMap<Db, Promise<unknown>>();

function ensureIndexes(db: Db) {
  let done = indexed.get(db);
  if (!done) {
    done = db.collection<TranscriptDoc>("transcripts").createIndex({ createdAt: 1 }, { expireAfterSeconds: TRANSCRIPT_TTL_SECONDS });
    done.catch(() => indexed.delete(db));
    indexed.set(db, done);
  }
  return done;
}

const toSession = (d: SessionDoc): VoiceSession => ({ id: d._id, start: d.start, endsAt: d.endsAt, endedAt: d.endedAt });

/** The voice store over `getDb` (the real voice database by default; tests pass a fake). */
export function voiceStore(getDb: () => Promise<Db> = voiceDb) {
  async function cols() {
    const db = await getDb();
    await ensureIndexes(db);
    return {
      sessions: db.collection<SessionDoc>("sessions"),
      attempts: db.collection<AttemptsDoc>("attempts"),
      transcripts: db.collection<TranscriptDoc>("transcripts"),
    };
  }

  return {
    /** Records a new call starting at `start`; it ends 5 minutes later. */
    async startSession(caller: Caller, start: Date): Promise<VoiceSession> {
      const doc: SessionDoc = {
        _id: randomUUID(),
        deviceHash: hashId(caller.deviceId),
        networkHash: hashId(caller.ip),
        start,
        endsAt: callEndsAt(start),
        endedAt: null,
      };
      await (await cols()).sessions.insertOne(doc);
      return toSession(doc);
    },

    async session(id: string): Promise<VoiceSession | null> {
      const doc = await (await cols()).sessions.findOne({ _id: id });
      return doc ? toSession(doc) : null;
    },

    /** Marks a call ended. False if it was unknown or already ended. */
    async endSession(id: string, now: Date): Promise<boolean> {
      const res = await (await cols()).sessions.updateOne({ _id: id, endedAt: null }, { $set: { endedAt: now } });
      return res.modifiedCount > 0;
    },

    /** When this device or network last started a call, for the cooldown. */
    async lastCallStart(caller: Caller): Promise<Date | null> {
      const [doc] = await (await cols()).sessions
        .find({ $or: [{ deviceHash: hashId(caller.deviceId) }, { networkHash: hashId(caller.ip) }] })
        .sort({ start: -1 })
        .limit(1)
        .toArray();
      return doc?.start ?? null;
    },

    /** Wrong-code record for one caller ID (device or network), or null if none. */
    async attempts(callerId: string): Promise<Attempts | null> {
      const doc = await (await cols()).attempts.findOne({ _id: hashId(callerId) });
      return doc ? { count: doc.count, lockedUntil: doc.lockedUntil } : null;
    },

    /** Counts one wrong code and returns the new record, with a lockout-until time on the 5th. */
    async addMiss(callerId: string, now: Date): Promise<Attempts> {
      const { attempts } = await cols();
      const _id = hashId(callerId);
      const prev = await attempts.findOne({ _id });
      const next = recordMiss(prev && { count: prev.count, lockedUntil: prev.lockedUntil }, now);
      await attempts.updateOne({ _id }, { $set: { ...next, updatedAt: now } }, { upsert: true });
      return next;
    },

    async clearMisses(callerId: string): Promise<void> {
      await (await cols()).attempts.deleteOne({ _id: hashId(callerId) });
    },

    /** Appends cleaned lines to a call's transcript, creating it (and its 30-day clock) on first use. */
    async addLines(sessionId: string, lines: TranscriptLine[], now: Date): Promise<void> {
      if (!lines.length) return;
      await (await cols()).transcripts.updateOne(
        { _id: sessionId },
        { $push: { lines: { $each: lines, $slice: MAX_TRANSCRIPT_LINES } }, $setOnInsert: { createdAt: now } },
        { upsert: true },
      );
    },

    async transcript(sessionId: string): Promise<Transcript | null> {
      const doc = await (await cols()).transcripts.findOne({ _id: sessionId });
      return doc ? { sessionId: doc._id, createdAt: doc.createdAt, lines: doc.lines } : null;
    },

    /** Transcripts created since `since`, newest first, one page at a time (at most 50 per page). */
    async listTranscripts({ since, page = 1, size = LIST_PAGE_SIZE }: { since: Date; page?: number; size?: number }) {
      const { transcripts } = await cols();
      const limit = Math.min(Math.max(1, Math.floor(size)), MAX_LIST_SIZE);
      const skip = (Math.max(1, Math.floor(page)) - 1) * limit;
      const filter = { createdAt: { $gte: since } };
      const [docs, total] = await Promise.all([
        transcripts.find(filter, { projection: { lines: 0 } }).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
        transcripts.countDocuments(filter),
      ]);
      return { items: docs.map((d) => ({ sessionId: d._id, createdAt: d.createdAt })), total };
    },
  };
}

export type VoiceStore = ReturnType<typeof voiceStore>;
