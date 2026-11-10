import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Stale-while-revalidate on the rules (B20): a shopper never waits on the Accelerator after an instance's first read. */

const book = (version: string) => ({ site: { id: "s", name: "S" }, pack: null, version, at: "", policies: [], rulings: [], mark: {}, scenarios: [], inForce: null, proof: null });

describe("getRuntime", () => {
  let pending: ((v: unknown) => void)[] = [];
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as { cradleBook?: unknown }).cradleBook;
    Object.assign(process.env, { CRADLE_API_URL: "https://acc.test", CRADLE_TOKEN: "t", ANTHROPIC_API_KEY: "k" });
    vi.useFakeTimers({ toFake: ["Date"] });
    pending = [];
    // Each fetch waits until the test answers it.
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => pending.push(resolve))));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const answer = (version: string) => pending.shift()!({ ok: true, json: async () => book(version) });
  const settled = async <T,>(p: Promise<T>) => Promise.race([p, new Promise((r) => setTimeout(() => r("pending"), 20))]);

  it("waits only for the first read, then serves the last copy while it refreshes", async () => {
    const { getRuntime } = await import("./book");
    const first = getRuntime();
    expect(await settled(first)).toBe("pending");
    answer("v1");
    expect((await first)?.version).toBe("v1");

    vi.setSystemTime(Date.now() + 20_000); // past the 15-second freshness window
    expect((await settled(getRuntime())) as { version: string }).toMatchObject({ version: "v1" }); // at once, not waiting
    expect(pending).toHaveLength(1); // one background refresh
    expect((await settled(getRuntime())) as { version: string }).toMatchObject({ version: "v1" }); // still at once, no second refresh
    expect(pending).toHaveLength(1);

    answer("v2");
    await new Promise((r) => setTimeout(r, 0));
    expect((await getRuntime())?.version).toBe("v2");
  });

  it("waits for a fresh copy when asked (the conformance gate)", async () => {
    const { getRuntime } = await import("./book");
    const first = getRuntime();
    answer("v1");
    await first;
    const fresh = getRuntime({ fresh: true });
    expect(await settled(fresh)).toBe("pending");
    answer("v2");
    expect((await fresh)?.version).toBe("v2");
  });

  it("keeps serving the last good rules when the Accelerator is down", async () => {
    const { getRuntime } = await import("./book");
    const first = getRuntime();
    answer("v1");
    await first;
    vi.setSystemTime(Date.now() + 20_000);
    expect((await getRuntime())?.version).toBe("v1");
    pending.shift()!({ ok: false, status: 503, json: async () => ({}) });
    await new Promise((r) => setTimeout(r, 0));
    expect((await getRuntime())?.version).toBe("v1");
  });
});
