import { describe, expect, it } from "vitest";

import type { RuntimeBook } from "./book";
import { groundingFor, introduce } from "./site";

const policy = (key: string, concept: string) => ({ key, title: key, statement: "", concept, event: "", criticality: "routine", parameters: {}, kernel: null, status: "confirmed", version: 1 }) as RuntimeBook["policies"][number];

const book = (over: Partial<RuntimeBook> = {}): RuntimeBook =>
  ({ site: { id: "s", name: "Acme Hardware" }, pack: { id: "commerce", version: "0.1.0" }, version: "v", at: "", policies: [policy("A", "price"), policy("B", "tax"), policy("C", "product")], rulings: [], ...over }) as RuntimeBook;

describe("introduce", () => {
  it("uses the description the owner registered", () => {
    expect(introduce(book({ site: { id: "s", name: "Acme Hardware", description: "A neighborhood hardware store with 4,000 products." } }))).toBe("Acme Hardware: A neighborhood hardware store with 4,000 products");
  });
  it("falls back to the industry pack, then the name, and names no site of its own", () => {
    expect(introduce(book({ pack: { id: "commerce", version: "1", label: "Commerce", summary: "Online stores: catalog and checkout." } }))).toBe("Acme Hardware: a Commerce site (Online stores: catalog and checkout)");
    expect(introduce(book())).toBe("Acme Hardware");
    expect(introduce(null)).toBe("this site");
  });
});

describe("groundingFor", () => {
  it("reads the concepts the pack names for each use", () => {
    expect(groundingFor(book({ pack: { id: "commerce", version: "1", grounding: { search: ["product", "price"] } } }), "search")).toEqual(["product", "price"]);
  });
  it("grounds on every concept in the book when the pack is silent (older books)", () => {
    expect(groundingFor(book(), "search")).toEqual(["price", "product", "tax"]);
  });
});
