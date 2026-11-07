import { describe, expect, it } from "vitest";

import { sameToken } from "./token";

describe("sameToken", () => {
  it("accepts only this store's own token", () => {
    expect(sameToken("crt_site.abcdef", "crt_site.abcdef")).toBe(true);
    expect(sameToken("crt_site.abcdeX", "crt_site.abcdef")).toBe(false);
    expect(sameToken("crt_site.abc", "crt_site.abcdef")).toBe(false);
    expect(sameToken("", undefined)).toBe(false);
    expect(sameToken("anything", undefined)).toBe(false);
  });
});
