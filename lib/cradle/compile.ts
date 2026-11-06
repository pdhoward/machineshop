import "server-only";

import { bookText, getBook, type RuntimeBook } from "./book";
import { COMPILE_MODEL, jsonCall, type Call } from "./model";
import { PROJECTION_SCHEMA, SAFE_PROJECTION, type Projection } from "./projection";

/**
 * Compile the book into the store's projections, once per book version (the
 * model reads the rules; the store then applies them without a model call).
 */

const SYSTEM = `You compile a store's policy book into the settings its software applies at runtime.
The store is Machine Shop, a test store selling home and workshop products, with Stripe Checkout in test mode.

Rules for reading the book:
- The steward's rulings override the policies they name, and settle contradictions between them.
- Confirmed policies apply. Unreviewed policies apply unless a ruling or a confirmed policy says otherwise. Disputed policies do not apply.
- Set each field only from what the book says; where it is silent, choose the cautious setting and say so in summary.
- Every "policies" list holds the keys (for example C-INV-1) of the policies and rulings that decided that section.
- Notices and reasons are shown to shoppers: short, plain English, one or two sentences.
- assistant.rules are instructions to the shop assistant: short imperative lines, taken from the book.
- summary: two sentences on what the store does under these rules.`;

const g = globalThis as unknown as { cradleProjection?: Map<string, Promise<{ projection: Projection; call: Omit<Call<unknown>, "data"> | null }>> };

export type Compiled = { book: RuntimeBook | null; projection: Projection; call: Omit<Call<unknown>, "data"> | null; compiled: boolean };

export async function compiledRules(): Promise<Compiled> {
  const book = await getBook();
  if (!book) return { book: null, projection: SAFE_PROJECTION, call: null, compiled: false };
  g.cradleProjection ??= new Map();
  let entry = g.cradleProjection.get(book.version);
  if (!entry) {
    entry = jsonCall<Projection>({
      model: COMPILE_MODEL(), effort: "medium", system: SYSTEM, schema: PROJECTION_SCHEMA as unknown as Record<string, unknown>, maxTokens: 8000,
      user: `The policy book (version ${book.version}):\n\n${bookText(book)}`,
    }).then(
      ({ data, ...call }) => {
        console.log(`[cradle] compiled book ${book.version} in ${call.ms}ms · $${call.costUsd.toFixed(4)}`);
        return { projection: data, call };
      },
      (err) => {
        console.error("[cradle] compile:", err instanceof Error ? err.message : err);
        g.cradleProjection!.delete(book.version); // try again on the next request
        return { projection: SAFE_PROJECTION, call: null };
      },
    );
    g.cradleProjection.set(book.version, entry);
  }
  const { projection, call } = await entry;
  return { book, projection, call, compiled: projection !== SAFE_PROJECTION };
}
