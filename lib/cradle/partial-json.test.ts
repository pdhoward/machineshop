import { describe, expect, it } from "vitest";

import { scanObject } from "./partial-json";

const FULL = `{"intent":"find","layout":"grid","query":"cordless drill","category":"","minPrice":0,"maxPrice":150,"inStockOnly":true,"headline":"Drills \\"under\\" $150","rulesApplied":["P-1","P-2"],"alternatives":[]}`;

describe("scanObject", () => {
  it("reads every field of a finished object", () => {
    const s = scanObject(FULL);
    expect(s.closed).toBe(true);
    expect(s.values).toEqual(JSON.parse(FULL));
    expect([...s.complete].sort()).toEqual(Object.keys(JSON.parse(FULL)).sort());
    expect(s.open).toBeNull();
  });

  it("never reports a value that isn't finished, at any cut point", () => {
    const whole = JSON.parse(FULL) as Record<string, unknown>;
    for (let n = 0; n <= FULL.length; n++) {
      const s = scanObject(FULL.slice(0, n));
      for (const k of s.complete) expect(s.values[k]).toEqual(whole[k]);
      // A field is only complete once something follows it.
      if (n < FULL.length) expect(s.complete.has("alternatives")).toBe(false);
    }
  });

  it("waits for the delimiter before trusting a number or literal", () => {
    expect(scanObject(`{"maxPrice":15`).complete.has("maxPrice")).toBe(false);
    expect(scanObject(`{"maxPrice":150,`).complete.has("maxPrice")).toBe(true);
    expect(scanObject(`{"inStockOnly":true`).complete.has("inStockOnly")).toBe(false);
    expect(scanObject(`{"inStockOnly":true }`).values.inStockOnly).toBe(true);
  });

  it("shows the string being written, without half an escape", () => {
    expect(scanObject(`{"intent":"find","headline":"Cordless dr`).open).toEqual({ key: "headline", value: "Cordless dr" });
    expect(scanObject(`{"headline":"Say \\"hi`).open?.value).toBe('Say "hi');
    expect(scanObject(`{"headline":"Say \\`).open?.value).toBe("Say ");
    expect(scanObject(`{"headline":"caf\\u00`).open?.value).toBe("caf");
    expect(scanObject(`{"headline":"caf\\u00e9!`).open?.value).toBe("café!");
    expect(scanObject(`{"headline":"a\\\\`).open?.value).toBe("a\\");
  });

  it("handles fields in any order, nested arrays and whitespace", () => {
    const s = scanObject(`{ "alternatives" : [ "floor mat", "broom" ] , "query" : "floor cleaner" , "layout"`);
    expect(s.values).toEqual({ alternatives: ["floor mat", "broom"], query: "floor cleaner" });
    expect([...s.complete]).toEqual(["alternatives", "query"]);
  });

  it("reports nothing for text that isn't an object yet", () => {
    expect(scanObject("").values).toEqual({});
    expect(scanObject("  ").complete.size).toBe(0);
  });
});
