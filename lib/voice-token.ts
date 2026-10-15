import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed voice session tokens: `<sessionId>.<endsAtMs>.<HMAC>` with
 * VOICE_SECRET. The browser holds one per call and sends it to the voice
 * routes as `Authorization: Bearer <token>`; a token can't be forged or
 * stretched past its end time without the secret.
 */

export type SessionClaim = { sessionId: string; endsAt: Date };

const MAX_TOKEN_CHARS = 200;

// The prefix keeps these signatures apart from the store's ID hashes, which use the same secret.
const sign = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(`voice-session:${payload}`).digest("base64url");

export function signSessionToken({ sessionId, endsAt }: SessionClaim, secret = process.env.VOICE_SECRET): string {
  if (!secret) throw new Error("VOICE_SECRET is not set.");
  const payload = `${sessionId}.${endsAt.getTime()}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** The session a token names, or null if it is missing, malformed or not signed with `secret`. */
export function verifySessionToken(token: string | null | undefined, secret = process.env.VOICE_SECRET): SessionClaim | null {
  if (!token || !secret || token.length > MAX_TOKEN_CHARS) return null;
  const [sessionId, ms, sig, ...rest] = token.split(".");
  if (!sessionId || !ms || !sig || rest.length) return null;
  const given = Buffer.from(sig);
  const expected = Buffer.from(sign(`${sessionId}.${ms}`, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const endsAt = new Date(Number(ms));
  return Number.isNaN(endsAt.getTime()) ? null : { sessionId, endsAt };
}

/** The token from an `Authorization: Bearer <token>` header, if any. */
export function bearerToken(request: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return m?.[1] ?? null;
}
