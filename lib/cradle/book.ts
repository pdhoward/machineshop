import "server-only";

/**
 * The policy book, read live from the Accelerator (cradle mode). The steward
 * changes a rule there; this store picks it up within seconds, with no code
 * change and no release. A failed read keeps the last good book.
 */

export type RuntimePolicy = {
  key: string;
  title: string;
  statement: string;
  concept: string;
  event: string;
  criticality: string;
  parameters: Record<string, unknown>;
  kernel: string | null;
  status: "confirmed" | "unreviewed" | "disputed";
  version: number;
};

export type RuntimeBook = {
  site: { id: string; name: string };
  pack: { id: string; version: string } | null;
  version: string;
  at: string;
  policies: RuntimePolicy[];
  rulings: { id: string; keys: string[]; ruling: string }[];
};

export const cradleConfigured = () => !!process.env.CRADLE_API_URL && !!process.env.CRADLE_TOKEN && !!process.env.ANTHROPIC_API_KEY;

const TTL_MS = 15_000;
const g = globalThis as unknown as { cradleBook?: { at: number; book: Promise<RuntimeBook | null>; good: RuntimeBook | null } };

async function fetchBook(): Promise<RuntimeBook> {
  const res = await fetch(`${process.env.CRADLE_API_URL!.replace(/\/+$/, "")}/api/runtime/book`, {
    headers: { authorization: `Bearer ${process.env.CRADLE_TOKEN}` },
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`The Accelerator answered ${res.status}`);
  return (await res.json()) as RuntimeBook;
}

/** The book in force (refreshed every 15 seconds), or null when it has never been read. */
export function getBook(): Promise<RuntimeBook | null> {
  if (!cradleConfigured()) return Promise.resolve(null);
  const cur = g.cradleBook;
  if (cur && Date.now() - cur.at < TTL_MS) return cur.book;
  const good = cur?.good ?? null;
  const book = fetchBook().then(
    (b) => ((g.cradleBook!.good = b), b),
    (err) => {
      console.error("[cradle] book:", err instanceof Error ? err.message : err);
      return good;
    },
  );
  g.cradleBook = { at: Date.now(), book, good };
  return book;
}

/** Only the policies a decision needs (the Ground step): by concept, plus the rulings that touch them. */
export function ground(book: RuntimeBook, concepts: string[]) {
  const policies = book.policies.filter((p) => concepts.includes(p.concept));
  const keys = new Set(policies.map((p) => p.key));
  const rulings = book.rulings.filter((r) => r.keys.some((k) => keys.has(k)));
  return { policies, rulings };
}

/** The book as compact text for a model: one line per policy, rulings last (they override). */
export function bookText(part: { policies: RuntimePolicy[]; rulings: RuntimeBook["rulings"] }): string {
  const lines = part.policies.map((p) => `${p.key} [${p.concept}${p.status === "confirmed" ? "" : `, ${p.status}`}] ${p.statement}${Object.keys(p.parameters ?? {}).length ? ` ${JSON.stringify(p.parameters)}` : ""}`);
  const rulings = part.rulings.map((r) => `RULING on ${r.keys.join(", ")}: ${r.ruling}`);
  return [...lines, ...(rulings.length ? ["", "The steward's rulings (they settle contradictions and override the policies they name):", ...rulings] : [])].join("\n");
}
