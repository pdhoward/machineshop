import { describe, expect, it } from "vitest";

import type { RuntimeBook } from "../book";
import { productSelector } from ".";

const book = (pack: RuntimeBook["pack"]) => ({ site: { id: "s", name: "S" }, pack, version: "v", at: "", policies: [], rulings: [] }) as RuntimeBook;
const items = [
  { title: "Blade Set for Riding Lawn Mowers", price: 70, rating: 4 },
  { title: "Reel Lawn Mower", price: 91, rating: 4 },
];

describe("productSelector", () => {
  it("runs the kernel the site's pack offers", () => {
    const s = productSelector(book({ id: "commerce", version: "1", kernels: [{ key: "catalog-relevance", label: "Catalog relevance", status: "available" }] }));
    expect(s.kernel).toBe("catalog-relevance");
    expect(s.select(items, "lawn mower", (x) => x, "price_low", 1)[0]!.title).toBe("Reel Lawn Mower");
  });

  it("never runs a kernel the pack doesn't offer, or only plans", () => {
    for (const pack of [
      { id: "hospitality", version: "1", kernels: [] },
      { id: "commerce", version: "1", kernels: [{ key: "catalog-relevance", label: "", status: "planned" as const }] },
      { id: "commerce", version: "1" },
      null,
    ]) {
      const s = productSelector(book(pack));
      expect(s.kernel).toBeNull();
      expect(s.select(items, "lawn mower", (x) => x, "price_low", 1)[0]!.title).toBe("Blade Set for Riding Lawn Mowers"); // the catalog's own order
    }
  });
});
