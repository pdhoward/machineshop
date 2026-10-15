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

/**
 * Owner sign-in tokens: `owner.<expiresAtMs>.<HMAC>`, kept in an httpOnly
 * cookie. The signature covers VOICE_OWNER_CODE as well, so changing the code
 * signs every owner out.
 */
type OwnerKeys = { secret?: string; code?: string };
const ownerKeys = (): OwnerKeys => ({ secret: process.env.VOICE_SECRET, code: process.env.VOICE_OWNER_CODE });

const signOwner = (ms: string, { secret, code }: Required<OwnerKeys>) =>
  createHmac("sha256", secret).update(`voice-owner:${ms}:${code}`).digest("base64url");

export function signOwnerToken(expiresAt: Date, keys: OwnerKeys = ownerKeys()): string {
  if (!keys.secret) throw new Error("VOICE_SECRET is not set.");
  if (!keys.code) throw new Error("VOICE_OWNER_CODE is not set.");
  const ms = String(expiresAt.getTime());
  return `owner.${ms}.${signOwner(ms, { secret: keys.secret, code: keys.code })}`;
}

/** True only for an owner token signed with these keys that hasn't expired at `now`. */
export function verifyOwnerToken(token: string | null | undefined, now: Date, keys: OwnerKeys = ownerKeys()): boolean {
  if (!token || !keys.secret || !keys.code || token.length > MAX_TOKEN_CHARS) return false;
  const [kind, ms, sig, ...rest] = token.split(".");
  if (kind !== "owner" || !ms || !/^\d+$/.test(ms) || !sig || rest.length) return false;
  const given = Buffer.from(sig);
  const expected = Buffer.from(signOwner(ms, { secret: keys.secret, code: keys.code }));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  return now.getTime() < Number(ms);
}

/** One cookie's value from the request, if present. */
export function cookieValue(request: Request, name: string): string | null {
  const found = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : null;
}

/** The token from an `Authorization: Bearer <token>` header, if any. */
export function bearerToken(request: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return m?.[1] ?? null;
}
