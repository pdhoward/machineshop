import "server-only";

import { randomUUID } from "node:crypto";

import { isLockedOut } from "./voice";
import type { Caller, VoiceStore } from "./voice-store";
import { cookieValue, verifyOwnerToken } from "./voice-token";

/**
 * Who is calling a voice route, and the wrong-code lockout they share. The
 * shopper's access code (app/api/voice/session) and the owner code
 * (app/api/voice/owner) count toward the same 5-attempt lockout, per device
 * and per network, so clearing cookies doesn't reset it.
 */

const DEVICE_COOKIE = "voice_device";
const DEVICE_MAX_AGE = 365 * 24 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Device = { id: string; fresh: boolean };

/** The device ID from the cookie, or a new one if it is missing or malformed. */
export function device(request: Request): Device {
  const value = cookieValue(request, DEVICE_COOKIE);
  return value && UUID.test(value) ? { id: value, fresh: false } : { id: randomUUID(), fresh: true };
}

/** `Set-Cookie` value that keeps the device ID (httpOnly, for every voice route). */
export const deviceCookie = (dev: Device) =>
  `${DEVICE_COOKIE}=${dev.id}; Path=/api/voice; Max-Age=${DEVICE_MAX_AGE}; HttpOnly; SameSite=Lax${secureFlag()}`;

export const secureFlag = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");

const clientIp = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

export const caller = (request: Request, dev: Device): Caller => ({ deviceId: dev.id, ip: clientIp(request) });

/** Wrong codes count against both the device and the network. */
export const callerIds = (c: Caller) => [`device:${c.deviceId}`, `network:${c.ip}`];

export const latest = (dates: (Date | null)[]) => {
  const times = dates.filter((d): d is Date => !!d).map((d) => d.getTime());
  return times.length ? new Date(Math.max(...times)) : null;
};

/** When the caller's lockout lifts, or null if they aren't locked out. */
export async function lockedUntil(store: VoiceStore, c: Caller, now: Date) {
  const records = await Promise.all(callerIds(c).map((id) => store.attempts(id)));
  return latest(records.map((r) => (isLockedOut(r, now) ? r!.lockedUntil : null)));
}

/** Counts one wrong code against the device and the network; returns when the lockout lifts if this one locked them out. */
export async function countMiss(store: VoiceStore, c: Caller, now: Date) {
  const after = await Promise.all(callerIds(c).map((id) => store.addMiss(id, now)));
  return latest(after.map((a) => a.lockedUntil));
}

export async function clearMisses(store: VoiceStore, c: Caller) {
  await Promise.all(callerIds(c).map((id) => store.clearMisses(id)));
}

// --- Owner sign-in ------------------------------------------------------------

const OWNER_COOKIE = "voice_owner";

/** `Set-Cookie` value for the owner's signed token: httpOnly, strict, owner routes only. Max-Age 0 signs out. */
export const ownerCookie = (token: string, maxAgeSeconds: number) =>
  `${OWNER_COOKIE}=${token}; Path=/api/voice/owner; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secureFlag()}`;

/** Whether the request carries a valid, unexpired owner cookie. */
export const isOwner = (request: Request, now: Date) => verifyOwnerToken(cookieValue(request, OWNER_COOKIE), now);
