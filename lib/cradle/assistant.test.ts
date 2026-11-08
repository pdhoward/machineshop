import { describe, expect, it, vi } from "vitest";

vi.mock("./compile", () => ({ compiledRules: vi.fn() }));

import { ensureBuyNow } from "./assistant";

// The ruling on C-CHK-1 / S-ASSIST-*: when asked to buy, the assistant directs the shopper to Buy now.
describe("ensureBuyNow", () => {
  it("adds the Buy now direction when a buying shopper didn't get one", () => {
    const out = ensureBuyNow("Just order a table saw for me", "Here are three table saws.", true);
    expect(out).toMatch(/press Buy now/);
    expect(out.startsWith("Here are three table saws.")).toBe(true);
  });
  it("leaves a reply that already names Buy now alone", () => {
    expect(ensureBuyNow("I want to buy this drill", "Press Buy now on its page.", true)).toBe("Press Buy now on its page.");
  });
  it("adds nothing when the shopper isn't buying, or the rules don't allow buying", () => {
    expect(ensureBuyNow("Which drill is lightest?", "This one.", true)).toBe("This one.");
    expect(ensureBuyNow("Order me a drill", "Ordering is off right now.", false)).toBe("Ordering is off right now.");
  });
});
