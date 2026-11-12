import { describe, expect, it } from "vitest";

import { bookText, type RuntimePolicy } from "./book";

const policy = (key: string, statement: string, status: RuntimePolicy["status"] = "confirmed") =>
  ({ key, title: key, statement, concept: "assistant", event: "answer", criticality: "routine", parameters: {}, kernel: null, status, version: 1 }) as RuntimePolicy;

describe("bookText", () => {
  it("marks a policy a ruling settled, so the model doesn't quote it as if it still stood", () => {
    const text = bookText({
      policies: [policy("S-ASSIST-1", "The store is a demonstration store; shoppers cannot order.", "unreviewed"), policy("C-PRICE-1", "Prices show in USD.")],
      rulings: [{ id: "R1", keys: ["S-ASSIST-1"], ruling: "Shoppers can order with Buy now." }],
    });
    expect(text).toContain("S-ASSIST-1 [assistant, unreviewed] (settled by a ruling below: where they differ, follow the ruling, not this) The store is a demonstration store");
    expect(text).toContain("C-PRICE-1 [assistant] Prices show in USD.");
    expect(text).toContain("RULING on S-ASSIST-1: Shoppers can order with Buy now.");
  });
});
