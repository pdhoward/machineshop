import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductCard } from "@/lib/product";

// No database: the catalog is replaced by fakes that each test sets up.
const catalog = vi.hoisted(() => ({
  PAGE_SIZE: 24,
  catalogConfigured: vi.fn(() => true),
  search: vi.fn(),
  listDepartments: vi.fn(),
}));
vi.mock("@/lib/catalog", () => catalog);

import { renderToString } from "react-dom/server";

import Home from "./page";

const card = (id: string, name: string, category: string): ProductCard => ({
  id, name, category, image: null, blurb: "", brand: "Acme", price: 19.99, currency: "USD", inStock: true, rating: 4.5, reviews: 12,
});

const PRODUCTS = [card("p1", "Claw Hammer", "Tools"), card("p2", "Cordless Drill", "Tools"), card("p3", "LED Shop Light", "Lighting")];
const DEPARTMENTS = [{ name: "Tools", count: 7200 }, { name: "Lighting", count: 3100 }];

// React marks text boundaries with <!-- -->; drop them so the checks read like the page.
const open = async (params: { q?: string; c?: string; page?: string } = {}) =>
  renderToString(await Home({ searchParams: Promise.resolve(params) })).replaceAll("<!-- -->", "");

beforeEach(() => {
  catalog.catalogConfigured.mockReturnValue(true);
  catalog.search.mockResolvedValue({ items: PRODUCTS, total: 10_300 });
  catalog.listDepartments.mockResolvedValue(DEPARTMENTS);
});

describe("home page", () => {
  it("opens with the heading, product count, departments and product cards", async () => {
    const html = await open();

    expect(html).toContain("Everything for the build.");
    expect(html).toContain("10,300 products");
    expect(html).toContain(">All</a>");
    for (const d of DEPARTMENTS) expect(html).toContain(d.name);
    for (const p of PRODUCTS) expect(html).toContain(p.name);
  });

  it("shows the setup notice and leaves the catalog alone when it is not set up", async () => {
    catalog.catalogConfigured.mockReturnValue(false);
    catalog.search.mockClear();
    catalog.listDepartments.mockClear();

    const html = await open();

    expect(html).toContain("Connect the catalog");
    expect(html).not.toContain("Everything for the build.");
    expect(catalog.search).not.toHaveBeenCalled();
    expect(catalog.listDepartments).not.toHaveBeenCalled();
  });

  it("shows the no-results message and the assistant button when a search finds nothing", async () => {
    catalog.search.mockResolvedValue({ items: [], total: 0 });

    const html = await open({ q: "nothing" });

    expect(html).toContain("Nothing matches that");
    expect(html).toContain("Ask the assistant");
    expect(html).not.toContain("Everything for the build.");
  });
});
