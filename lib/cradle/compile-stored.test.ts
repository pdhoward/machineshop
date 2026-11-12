import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeBook, StoredProjection } from "./book";
import { SAFE_PROJECTION } from "./projection";

/** B11: a version is compiled once for the whole app; every other server reads the stored settings. */

const mocks = vi.hoisted(() => ({ jsonCall: vi.fn() }));
vi.mock("./model", () => ({ COMPILE_MODEL: () => "claude-sonnet-5-5", jsonCall: mocks.jsonCall }));
vi.mock("./usage", () => ({ reportUsage: () => {} }));

const book = { site: { id: "s", name: "Acme" }, pack: null, version: "abcd1234", at: "", policies: [], rulings: [] } as RuntimeBook;
const settings = { ...SAFE_PROJECTION, summary: "Compiled once, elsewhere." };

describe("compileBook", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as { cradleProjection?: unknown }).cradleProjection;
    mocks.jsonCall.mockReset();
    mocks.jsonCall.mockResolvedValue({ data: settings, model: "claude-sonnet-5-5", ms: 6000, tokensIn: 1, tokensOut: 1, costUsd: 0.017 });
  });

  it("uses the settings another server stored, with no model call", async () => {
    const { compileBook, compilerOf } = await import("./compile");
    const stored: StoredProjection[] = [{ version: "abcd1234", schema: compilerOf(book), projection: settings, model: "claude-sonnet-5-5", costUsd: 0.017, at: "" }];
    const e = await compileBook(book, stored);
    expect(e.source).toBe("stored");
    expect(e.projection.summary).toBe("Compiled once, elsewhere.");
    expect(mocks.jsonCall).not.toHaveBeenCalled();
  });

  it("compiles when the stored settings came from another compiler, another version, or are malformed", async () => {
    const { compileBook, compilerOf } = await import("./compile");
    const stored: StoredProjection[] = [
      { version: "abcd1234", schema: "00000000", projection: settings, model: "m", costUsd: 0, at: "" },
      { version: "ffff0000", schema: compilerOf(book), projection: settings, model: "m", costUsd: 0, at: "" },
      { version: "abcd1234", schema: compilerOf(book), projection: { nope: true }, model: "m", costUsd: 0, at: "" },
    ];
    const e = await compileBook(book, stored);
    expect(e.source).toBe("compiled");
    expect(mocks.jsonCall).toHaveBeenCalledTimes(1);
  });

  it("the compiler's fingerprint changes with what it is told about the site", async () => {
    const { compilerOf } = await import("./compile");
    expect(compilerOf(book)).toBe(compilerOf({ ...book }));
    expect(compilerOf({ ...book, site: { ...book.site, description: "A hardware store." } })).not.toBe(compilerOf(book));
  });
});
