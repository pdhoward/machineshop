import { timingSafeEqual } from "node:crypto";

/** The Accelerator's call carries this store's own CRADLE_TOKEN; compared in constant time. */
export function sameToken(got: string, want: string | undefined): boolean {
  if (!want || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
