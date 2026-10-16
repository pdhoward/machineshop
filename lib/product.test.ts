import { describe, expect, it } from "vitest";

import { blurbOf, imageAt, parseSpecs, SHEET_HIGHLIGHTS, SHEET_SPECS, sheetFields, toCard, toProduct, type RawProduct } from "./product";

// The example document from the catalog (trimmed).
const RAW: RawProduct = {
  _id: "61faa06ec3f85b5eb698f8b9",
  url: "https://www.homedepot.com/p/Antica-Trattoria/315701110",
  source: "https://www.homedepot.com/",
  name: '"Antica Trattoria" by Colossal Images Unframed Canvas Print Architecture Photography Wall Art 54 in. x 36 in.',
  images:
    "https://images.thdstatic.com/productImages/014f/svn/art-lc163-l-64_100.jpg ~ https://images.thdstatic.com/productImages/b95f/svn/art-lc163-l-c3_100.jpg",
  description:
    "Transport yourself to a place of wonder with this beautiful photo canvas from Colossal Images. This photo will enhance any room with its beautiful colors.",
  brand: "Unbranded",
  price: 247.49,
  in_stock: "TRUE",
  currency: "USD",
  color: "Multi-Colored",
  breadcrumbs: "Home Decor, Wall Decor, Wall Art, Photography Wall Art",
  avg_rating: "",
  total_reviews: "",
  overview: "Vibrant country photo art, Bring beauty and class to your living space with this contemporary photograph wall art, Gallery wrapped canvas print",
  specifications: `[{'Art Movement': 'Contemporary'}, {"Artist's name": 'Colossal Images'}, {'Product Weight (lb.)': '10'}]`,
};

describe("toCard", () => {
  const card = toCard(RAW);
  it("maps the essentials", () => {
    expect(card.id).toBe("61faa06ec3f85b5eb698f8b9");
    expect(card.price).toBe(247.49);
    expect(card.inStock).toBe(true);
    expect(card.category).toBe("Home Decor");
  });
  it("upsizes the thumbnail and drops 'Unbranded'", () => {
    expect(card.image).toBe("https://images.thdstatic.com/productImages/014f/svn/art-lc163-l-64_400.jpg");
    expect(card.brand).toBeNull();
  });
  it("uses the first sentence as the blurb", () => {
    expect(card.blurb).toBe("Transport yourself to a place of wonder with this beautiful photo canvas from Colossal Images.");
  });
  it("treats empty ratings as none and string prices as numbers", () => {
    expect(card.rating).toBeNull();
    expect(toCard({ ...RAW, price: "$1,099.00", in_stock: "FALSE" })).toMatchObject({ price: 1099, inStock: false });
  });
});

describe("toProduct", () => {
  const p = toProduct(RAW);
  it("keeps every image at full size, the category trail and the source", () => {
    expect(p.images).toHaveLength(2);
    expect(p.images[1]).toMatch(/_1000\.jpg$/);
    expect(p.categories).toEqual(["Home Decor", "Wall Decor", "Wall Art", "Photography Wall Art"]);
    expect(p.sourceHost).toBe("homedepot.com");
  });
  it("splits the overview into highlights", () => {
    expect(p.highlights).toEqual([
      "Vibrant country photo art",
      "Bring beauty and class to your living space with this contemporary photograph wall art",
      "Gallery wrapped canvas print",
    ]);
  });
});

describe("sheetFields", () => {
  const ORIGIN = "https://shop.example.test";
  const p = toProduct(RAW);

  it("picks the large image, formatted price, stock text and full product link", () => {
    const s = sheetFields(p, ORIGIN);
    expect(s.image).toBe("https://images.thdstatic.com/productImages/014f/svn/art-lc163-l-64_1000.jpg");
    expect(s.price).toBe("$247.49");
    expect(s.stock).toBe("In stock");
    expect(s.inStock).toBe(true);
    expect(s.name).toBe(p.name);
    expect(s.brand).toBeNull();
    expect(s.highlights).toEqual(p.highlights);
    expect(s.specs).toEqual(p.specs);
    expect(s.link).toBe(`${ORIGIN}/p/61faa06ec3f85b5eb698f8b9`);
    expect(sheetFields(p, `${ORIGIN}/`).link).toBe(`${ORIGIN}/p/61faa06ec3f85b5eb698f8b9`);
  });

  it("says when a product is out of stock", () => {
    expect(sheetFields(toProduct({ ...RAW, in_stock: "FALSE" }), ORIGIN)).toMatchObject({ stock: "Out of stock", inStock: false });
  });

  it("keeps at most 8 highlights and 12 specs, in order", () => {
    const overview = Array.from({ length: 11 }, (_, i) => `Highlight ${i + 1}`).join(", ");
    const specifications = `[${Array.from({ length: 15 }, (_, i) => `{'Spec ${i + 1}': 'Value ${i + 1}'}`).join(", ")}]`;
    const many = toProduct({ ...RAW, overview, specifications });
    expect(many.highlights).toHaveLength(11);
    expect(many.specs).toHaveLength(15);
    const s = sheetFields(many, ORIGIN);
    expect(s.highlights).toHaveLength(SHEET_HIGHLIGHTS);
    expect(SHEET_HIGHLIGHTS).toBe(8);
    expect(s.highlights[7]).toBe("Highlight 8");
    expect(s.specs).toHaveLength(SHEET_SPECS);
    expect(SHEET_SPECS).toBe(12);
    expect(s.specs[11]).toEqual({ label: "Spec 12", value: "Value 12" });
  });

  it("handles a product with no image", () => {
    const s = sheetFields(toProduct({ ...RAW, images: "" }), ORIGIN);
    expect(s.image).toBeNull();
    expect(s.price).toBe("$247.49");
  });

  it("handles a product with no price", () => {
    const s = sheetFields(toProduct({ ...RAW, price: "" }), ORIGIN);
    expect(s.price).toBe("Price unavailable");
    expect(s.image).not.toBeNull();
  });

  it("handles a product with no highlights or specs", () => {
    const s = sheetFields(toProduct({ ...RAW, overview: "", specifications: "" }), ORIGIN);
    expect(s.highlights).toEqual([]);
    expect(s.specs).toEqual([]);
  });
});

describe("helpers", () => {
  it("parses Python-style specifications, including double-quoted keys", () => {
    expect(parseSpecs(RAW.specifications)).toEqual([
      { label: "Art Movement", value: "Contemporary" },
      { label: "Artist's name", value: "Colossal Images" },
      { label: "Product Weight (lb.)", value: "10" },
    ]);
    expect(parseSpecs(undefined)).toEqual([]);
  });
  it("leaves non-sized image URLs alone", () => {
    expect(imageAt("https://example.com/a.jpg", 600)).toBe("https://example.com/a.jpg");
  });
  it("caps long blurbs on a word boundary", () => {
    const long = `${"word ".repeat(60)}end.`;
    const b = blurbOf(long, "");
    expect(b.length).toBeLessThanOrEqual(150);
    expect(b.endsWith("…")).toBe(true);
  });
});
