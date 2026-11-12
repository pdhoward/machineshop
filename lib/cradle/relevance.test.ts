import { describe, expect, it } from "vitest";

import { rankByRelevance, relevance, selectProducts } from "./relevance";

// Real titles from a home-and-workshop catalog: what a keyword search returns for "lawn mower", in the kernel's order.
const MOWER_HITS = [
  { title: "50 in. Original Equipment High-Lift Blade Set for Select Riding Lawn Mowers with S-Shape Center", trail: ["Outdoors", "Outdoor Power Equipment Parts", "Lawn Mower Blades"] },
  { title: "6 in. x 1.5 in. Universal Plastic Wheel for Lawn Mowers", trail: ["Outdoors", "Outdoor Power Equipment Parts", "Lawn Mower Wheels"] },
  { title: "16 in. Manual Walk Behind Reel Lawn Mower with 9 Position Cutting Heights", trail: ["Outdoors", "Outdoor Power Equipment", "Lawn Mowers", "Reel Lawn Mowers"] },
  { title: "40 in. Tow-Behind Spike Aerator", trail: ["Outdoors", "Lawn Mower Attachments"] },
  { title: "20 in. 20V MAX Lithium-Ion Cordless Walk Behind Push Lawn Mower", trail: ["Outdoors", "Outdoor Power Equipment", "Lawn Mowers", "Push Lawn Mowers"] },
];

const titles = (xs: { title: string }[]) => xs.map((x) => x.title.slice(0, 28));

describe("selectProducts", () => {
  // The Owner's search, 2026-11-12: "compare two of the least expensive lawn mowers". The kernel's candidates, cheapest first.
  const HITS = [
    { title: "6 in. x 1.5 in. Universal Plastic Wheel for Lawn Mowers", price: 11.99, rating: 4 },
    { title: "TimeCutter 54 in. Striping Kit", trail: ["Outdoors", "Lawn Mower Attachments"], price: 89.99, rating: 3 },
    { title: "16 in. Manual Walk Behind Reel Lawn Mower with 9 Position Cutting Heights", price: 91.06, rating: 4 },
    { title: "PRO 21 in. 60-Volt Battery Cordless Self-Propelled Lawn Mower", price: 499, rating: 4.6 },
    { title: "Z365R 48 in. 24 HP Gas Dual Hydrostatic Zero-Turn Riding Mower", price: 3399, rating: 5 },
  ];
  const view = (x: (typeof HITS)[number]) => x;

  it("the cheapest two lawn mowers are mowers, not the parts that fit one, and exactly two", () => {
    expect(selectProducts(HITS, "lawn mower", view, "price_low", 2).map((x) => x.price)).toEqual([91.06, 499]);
  });

  it("orders by price high or rating when asked, and by relevance otherwise", () => {
    expect(selectProducts(HITS, "mower", view, "price_high", 1)[0]!.price).toBe(3399);
    expect(selectProducts(HITS, "mower", view, "rating", 2).map((x) => x.rating)).toEqual([5, 4.6]);
    expect(selectProducts(HITS, "lawn mower", view, "relevance", 3)).toHaveLength(3);
  });

  it("falls back to every candidate when too few are named by the keywords", () => {
    expect(selectProducts(HITS, "striping", view, "price_low", 2).map((x) => x.price)).toEqual([89.99]);
    expect(selectProducts(HITS, "garden tractor", view, "price_low", 2).map((x) => x.price)).toEqual([11.99, 89.99]);
  });
});

describe("rankByRelevance", () => {
  it("puts the products themselves before the parts that fit them", () => {
    const ranked = rankByRelevance(MOWER_HITS, "lawn mower", (x) => x);
    expect(titles(ranked.slice(0, 2))).toEqual(["16 in. Manual Walk Behind Re", "20 in. 20V MAX Lithium-Ion C"]);
    expect(titles(ranked.slice(2))).toContain("6 in. x 1.5 in. Universal Pl");
  });

  it("reads accessories by what comes after 'for', with no catalog-specific words", () => {
    const vac = { title: "16 Gal. 6.5-Peak HP Wet/Dry Shop Vacuum" };
    const hose = { title: "16 ft. Vacuum Hose with Dust Collection Adapter Set for Wet/Dry Vacs" };
    const pool = { title: "Evo 502 Robotic In Ground All Surface Swimming Pool Cleaner Vacuum Cleaner" };
    expect(relevance(vac, "wet dry vacuum")).toBeGreaterThan(relevance(hose, "wet dry vacuum"));
    expect(rankByRelevance([hose, pool, vac], "wet dry vacuum", (x) => x)[0]).toBe(vac);
  });

  it("matches singular and plural forms as words", () => {
    expect(relevance({ title: "LED Shop Light, 4 ft." }, "shop lights")).toBeGreaterThan(relevance({ title: "Workshop Lighting Clamp" }, "shop lights"));
    expect(relevance({ title: "AA Batteries (24-Pack)" }, "battery")).toBeGreaterThan(0);
  });

  it("keeps the kernel's order when the words don't tell products apart", () => {
    const same = [{ title: "Cordless Drill A" }, { title: "Cordless Drill B" }, { title: "Cordless Drill C" }];
    expect(rankByRelevance(same, "cordless drill", (x) => x)).toEqual(same);
    expect(rankByRelevance(same, "", (x) => x)).toEqual(same);
  });
});
