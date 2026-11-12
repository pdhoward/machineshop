import "server-only";

import { after } from "next/server";

import { awaitingProof, bookText, cradleConfigured, cradleHeaders, cradleUrl, getBook, getRuntime, type RuntimeBook, type StoredProjection } from "./book";
import { modelFault, type Fault } from "./fault";
import { COMPILE_MODEL, jsonCall, type Call } from "./model";
import { reportUsage } from "./usage";
import { introduce } from "./site";
import { stripeReady } from "../stripe";
import { PROJECTION_SCHEMA, SAFE_PROJECTION, type Projection } from "./projection";

/**
 * Compile a book into the store's projections, once per book version (the
 * model reads the rules; the store then applies them without a model call).
 *
 * Once per version for the whole app, not per server (B11): the first server
 * to compile a version stores the settings on the Accelerator, and every other
 * server (a new deploy, a cold serverless instance) reads them with the book,
 * in milliseconds instead of about 6 seconds and 2 cents.
 */

// Which site this is comes from its registration (in the book) and its checkout mode from the environment: nothing here names a site.
const SYSTEM = `You compile a store's policy book into the settings its software applies at runtime.

Rules for reading the book:
- The steward's rulings override the policies they name, and settle contradictions between them.
- Confirmed policies apply. Unreviewed policies apply unless a ruling or a confirmed policy says otherwise. Disputed policies do not apply.
- Set each field only from what the book says; where it is silent, choose the cautious setting and say so in summary.
- Every "policies" list holds the keys (for example C-INV-1) of the policies and rulings that decided that section.
- Notices and reasons are shown to shoppers: short, plain English, one or two sentences.
- assistant.rules are instructions to the shop assistant: short imperative lines, taken from the book.
- summary: two sentences on what the store does under these rules.`;

/**
 * The compiler's fingerprint: its instructions, the settings' shape, and what
 * it is told about the site (its description, the checkout mode). Settings
 * stored by a compiler with another fingerprint are not used.
 */
export function compilerOf(book: RuntimeBook): string {
  return fnv([SYSTEM, JSON.stringify(PROJECTION_SCHEMA), introduce(book), stripeReady() ? "test" : "none"].join("\u0000"));
}

/** FNV-1a: a short, stable fingerprint (the same as the Accelerator's). */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Stored settings are used only when they have the shape this app applies. */
const looksCompiled = (p: unknown): p is Projection => {
  const x = p as Partial<Projection> | null;
  return !!x && typeof x === "object" && !!x.buy && !!x.search && !!x.notices && !!x.assistant;
};

/**
 * fault: the compile failed because the app couldn't reach its model (out of credit…), not because of the book (B18).
 * source: compiled on this server, read from the Accelerator, or the safe settings.
 */
type Entry = { projection: Projection; call: Omit<Call<unknown>, "data"> | null; fault?: Fault | null; source: "compiled" | "stored" | "safe" };
const g = globalThis as unknown as { cradleProjection?: Map<string, Promise<Entry>>; cradleProving?: Set<string> };

/** One book version's projections (memoized; a failed compile is retried on the next request). `stored`: the settings the Accelerator holds. */
export function compileBook(book: RuntimeBook, stored: StoredProjection[] = []): Promise<Entry> {
  g.cradleProjection ??= new Map();
  let entry = g.cradleProjection.get(book.version);
  const schema = compilerOf(book);
  const have = stored.find((s) => s.version === book.version && s.schema === schema && looksCompiled(s.projection));
  if (!entry && have) {
    entry = Promise.resolve({ projection: have.projection as unknown as Projection, call: null, fault: null, source: "stored" as const });
    g.cradleProjection.set(book.version, entry);
  }
  if (!entry) {
    entry = jsonCall<Projection>({
      role: "compile", model: COMPILE_MODEL(), effort: "medium", system: SYSTEM, schema: PROJECTION_SCHEMA as unknown as Record<string, unknown>, maxTokens: 8000,
      user: `The site: ${introduce(book)}. ${stripeReady() ? "Payments run through Stripe Checkout in test mode: no real charges." : "No payment provider is connected."}\n\nThe policy book (version ${book.version}):\n\n${bookText(book)}`,
    }).then(
      ({ data, ...call }) => {
        console.log(`[cradle] compiled book ${book.version} in ${call.ms}ms · $${call.costUsd.toFixed(4)}`);
        reportUsage("compile", call);
        shareProjection({ version: book.version, schema, projection: data as unknown as Record<string, unknown>, model: call.model, costUsd: call.costUsd });
        return { projection: data, call, fault: null, source: "compiled" as const };
      },
      (err) => {
        console.error("[cradle] compile:", err instanceof Error ? err.message : err);
        g.cradleProjection!.delete(book.version);
        return { projection: SAFE_PROJECTION, call: null, fault: modelFault(err), source: "safe" as const };
      },
    );
    g.cradleProjection.set(book.version, entry);
  }
  return entry;
}

/** Store a version's settings on the Accelerator, so the app's other servers read them instead of compiling (B11). Never blocks or fails a request. */
function shareProjection(p: Omit<StoredProjection, "at">) {
  if (!cradleConfigured() || process.env.NODE_ENV === "test") return;
  const send = async () => {
    try {
      const res = await fetch(cradleUrl("/api/runtime/projection"), { method: "POST", headers: cradleHeaders(), body: JSON.stringify(p), signal: AbortSignal.timeout(8000) });
      if (!res.ok && res.status !== 409) console.error(`[cradle] storing compiled settings: the Accelerator answered ${res.status}`);
    } catch (err) {
      console.error("[cradle] storing compiled settings:", err instanceof Error ? err.message : err);
    }
  };
  try {
    after(send);
  } catch {
    void send(); // outside a request (a compile started by a proof)
  }
}

/** compiledNow: this request is the one that compiled the rules (it waited for it, and paid for it). source: where the settings came from. */
export type Compiled = { book: RuntimeBook | null; projection: Projection; call: Entry["call"]; compiled: boolean; compiledNow: boolean; source: Entry["source"] };
export type Rules = { book: RuntimeBook; projection: Projection };

/** The rules in force, compiled. When newer rules are waiting, this request also starts proving them (in the background). */
export async function compiledRules(): Promise<Compiled> {
  const [book, runtime] = await Promise.all([getBook(), getRuntime()]);
  if (runtime && awaitingProof(runtime)) startProving(runtime.version);
  if (!book) return { book: null, projection: SAFE_PROJECTION, call: null, compiled: false, compiledNow: false, source: "safe" };
  const first = !g.cradleProjection?.has(book.version);
  const { projection, call, source } = await compileBook(book, runtime?.projections);
  return { book, projection, call, compiled: projection !== SAFE_PROJECTION, compiledNow: first && !!call, source };
}

/** Run the conformance gate on a new version after this response is sent (one proof per version per server instance; the Accelerator refuses duplicates across instances). */
function startProving(version: string) {
  g.cradleProving ??= new Set();
  if (g.cradleProving.has(version)) return;
  g.cradleProving.add(version);
  try {
    after(async () => {
      const { proveLatest } = await import("./conformance");
      await proveLatest().catch((err) => console.error("[cradle] proof:", err instanceof Error ? err.message : err));
      g.cradleProving!.delete(version);
    });
  } catch {
    g.cradleProving.delete(version); // outside a request: the next request starts it
  }
}
