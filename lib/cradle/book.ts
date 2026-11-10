import "server-only";

import { after } from "next/server";

/**
 * The policy book, read live from the Accelerator (cradle mode). The steward
 * changes a rule there; this store proves the new version against its
 * scenarios (the conformance gate) and switches to it only when every one
 * passes. Until then the version that last passed stays in force. A failed
 * read keeps the last good copy.
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

export type ScenarioCheck =
  | { kind: "buy"; product: { price: number | null; currency: string; stock: "in" | "out" | "unknown" }; expect: boolean }
  | { kind: "search"; request: string; expect: { noOutOfStock: boolean; maxPrice: number | null; minResults: number } }
  | { kind: "assistant"; message: string; expect: { mustCall: string[]; mustNotCall: string[]; replyMust: string } }
  | { kind: "notice"; field: "productPage" | "footer" | "orderTestMode" | "orderLiveMode"; must: string };

export type Scenario = {
  id: string;
  title: string;
  policies: string[];
  criticality: "critical" | "important" | "routine";
  given: string;
  when: string;
  then: string;
  check: ScenarioCheck;
  status: "draft" | "approved" | "retired";
  source: "example" | "ruling" | "crew";
};

export type CaseResult = { id: string; passed: boolean; runs: number; passes: number; detail: string; ms: number };
export type Proof = { bookVersion: string; at: string; status: "requested" | "running" | "passed" | "failed" | "blocked"; results: CaseResult[]; passed: number; total: number; costUsd: number };

export type RuntimeResponse = RuntimeBook & {
  mark: { title: string; tagline: string; by: string };
  scenarios: Scenario[];
  inForce: { version: string; at: string; book: RuntimeBook } | null;
  proof: Proof | null;
};

export const MARK = { title: "Running on AI", tagline: "Intelligence matters", by: "Accelerator Cradle" };

export const cradleConfigured = () => !!process.env.CRADLE_API_URL && !!process.env.CRADLE_TOKEN && !!process.env.ANTHROPIC_API_KEY;

const TTL_MS = 15_000;
type Cache = { at: number; res: Promise<RuntimeResponse | null>; good: RuntimeResponse | null; refreshing?: boolean };
const g = globalThis as unknown as { cradleBook?: Cache };

export const cradleUrl = (path: string) => `${process.env.CRADLE_API_URL!.replace(/\/+$/, "")}${path}`;
export const cradleHeaders = () => ({ authorization: `Bearer ${process.env.CRADLE_TOKEN}`, "content-type": "application/json" });

async function fetchRuntime(): Promise<RuntimeResponse> {
  const res = await fetch(cradleUrl("/api/runtime/book"), { headers: cradleHeaders(), cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`The Accelerator answered ${res.status}`);
  return (await res.json()) as RuntimeResponse;
}

/**
 * Everything the Accelerator says about this store's rules, or null when never read.
 * Stale-while-revalidate (B20): within 15 seconds the cached copy serves; after
 * that the last good copy still serves at once and a fresh one is fetched in the
 * background (after the response), so a shopper never waits on the Accelerator
 * except on an instance's very first read. `fresh` waits for a new copy (the
 * conformance gate must prove the newest version, not the one it last saw).
 */
export function getRuntime(opts?: { fresh?: boolean }): Promise<RuntimeResponse | null> {
  if (!cradleConfigured()) return Promise.resolve(null);
  const cur = g.cradleBook;
  if (cur && !opts?.fresh && Date.now() - cur.at < TTL_MS) return cur.res;
  if (cur?.good && !opts?.fresh) {
    if (!cur.refreshing) {
      cur.refreshing = true;
      // The cached copy stays in place until the new one has arrived, so no request waits on the refresh.
      const refresh = () =>
        fetchRuntime().then(
          (r) => void (g.cradleBook = { at: Date.now(), res: Promise.resolve(r), good: r }),
          (err) => {
            console.error("[cradle] book:", err instanceof Error ? err.message : err);
            Object.assign(cur, { at: Date.now(), refreshing: false }); // unreachable: keep the last good rules, try again in 15 s
          },
        );
      try {
        after(refresh); // inside a request: keeps the refresh alive past the response
      } catch {
        void refresh();
      }
    }
    return Promise.resolve(cur.good);
  }
  // An instance's first read (or a fresh one): wait for it.
  const good = cur?.good ?? null;
  const res = fetchRuntime().then(
    (r) => {
      if (g.cradleBook?.res === res) g.cradleBook.good = r;
      return r;
    },
    (err) => {
      console.error("[cradle] book:", err instanceof Error ? err.message : err);
      return good; // the Accelerator is unreachable: keep serving the last good rules
    },
  );
  g.cradleBook = { at: Date.now(), res, good };
  return res;
}

/** The newest rules, as a plain book. */
export const liveBook = (r: RuntimeResponse): RuntimeBook => ({ site: r.site, pack: r.pack, version: r.version, at: r.at, policies: r.policies, rulings: r.rulings });

/**
 * The book in force: the version that last passed the conformance gate.
 * Before the first proof there is none, so the live book serves (the gate
 * starts holding once a version has passed).
 */
export async function getBook(): Promise<RuntimeBook | null> {
  const r = await getRuntime();
  if (!r) return null;
  return r.inForce?.book ?? liveBook(r);
}

/** Newer rules are waiting to be proven: never tried, asked for again by the steward, or a proof that stalled. A failed version stays held until then. */
export const awaitingProof = (r: RuntimeResponse) =>
  r.inForce?.version !== r.version && (!r.proof || r.proof.status === "requested" || ((r.proof.status === "running" || r.proof.status === "blocked") && Date.now() - Date.parse(r.proof.at) > 10 * 60_000));

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
