/**
 * Catalog documents → clean product data. Pure (no database), so it's unit
 * tested and shared by pages and the assistant. The raw documents come from a
 * 2021 crawl: prices may be strings, images are one "~"-separated string,
 * specifications are a Python-style list of one-key dicts.
 */

export type RawProduct = {
  _id: { toString(): string } | string;
  name?: unknown;
  images?: unknown;
  description?: unknown;
  overview?: unknown;
  brand?: unknown;
  price?: unknown;
  currency?: unknown;
  in_stock?: unknown;
  color?: unknown;
  breadcrumbs?: unknown;
  avg_rating?: unknown;
  total_reviews?: unknown;
  specifications?: unknown;
  source?: unknown;
  url?: unknown;
};

export type ProductCard = {
  id: string;
  name: string;
  image: string | null;
  blurb: string;
  brand: string | null;
  price: number | null;
  currency: string;
  inStock: boolean;
  category: string | null;
  rating: number | null;
  reviews: number | null;
};

export type Product = ProductCard & {
  images: string[];
  description: string;
  highlights: string[];
  categories: string[];
  color: string | null;
  specs: { label: string; value: string }[];
  sourceHost: string | null;
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(str(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Home Depot image URLs end in _<size>.jpg; the crawl stored the 100px thumbnail. */
export const imageAt = (url: string, size: 400 | 600 | 1000) => url.replace(/_(\d{2,4})\.(jpe?g|png|webp)$/i, `_${size}.$2`);

export const parseImages = (v: unknown) =>
  str(v)
    .split("~")
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//.test(s));

export const parseCategories = (v: unknown) =>
  str(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** "[{'Art Movement': 'Contemporary'}, {"Artist's name": 'Colossal Images'}]" → label/value pairs. */
export function parseSpecs(v: unknown): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const m of str(v).matchAll(/\{\s*(['"])(.*?)\1\s*:\s*(['"])(.*?)\3\s*\}/g)) {
    const label = m[2]!.trim();
    const value = m[4]!.trim();
    if (label && value) out.push({ label, value });
  }
  return out;
}

/** First sentence of the description (or the overview), at most ~150 characters. */
export function blurbOf(description: string, overview: string): string {
  const text = description || overview;
  const first = text.match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? text;
  return first.length <= 150 ? first : `${first.slice(0, 147).replace(/\s+\S*$/, "")}…`;
}

export function toCard(raw: RawProduct): ProductCard {
  const images = parseImages(raw.images);
  const brand = str(raw.brand);
  const reviews = num(raw.total_reviews);
  return {
    id: raw._id.toString(),
    name: str(raw.name).replace(/^"(.+?)"/, "“$1”") || "Untitled product",
    image: images[0] ? imageAt(images[0], 400) : null,
    blurb: blurbOf(str(raw.description), str(raw.overview)),
    brand: brand && brand.toLowerCase() !== "unbranded" ? brand : null,
    price: num(raw.price),
    currency: str(raw.currency) || "USD",
    inStock: str(raw.in_stock).toUpperCase() !== "FALSE",
    category: parseCategories(raw.breadcrumbs)[0] ?? null,
    rating: num(raw.avg_rating),
    reviews: reviews ? Math.round(reviews) : null,
  };
}

export function toProduct(raw: RawProduct): Product {
  let sourceHost: string | null = null;
  try {
    sourceHost = new URL(str(raw.source) || str(raw.url)).hostname.replace(/^www\./, "");
  } catch {}
  return {
    ...toCard(raw),
    images: parseImages(raw.images).map((u) => imageAt(u, 1000)),
    description: str(raw.description),
    highlights: str(raw.overview)
      .split(/,\s+(?=[A-Z])/)
      .map((s) => s.trim())
      .filter(Boolean),
    categories: parseCategories(raw.breadcrumbs),
    color: str(raw.color) || null,
    specs: parseSpecs(raw.specifications),
    sourceHost,
  };
}

export const money = (price: number | null, currency = "USD") =>
  price == null ? "Price unavailable" : price.toLocaleString("en-US", { style: "currency", currency });

export const SHEET_HIGHLIGHTS = 8;
export const SHEET_SPECS = 12;

export type SheetFields = {
  name: string;
  brand: string | null;
  image: string | null;
  price: string;
  stock: string;
  inStock: boolean;
  highlights: string[];
  specs: { label: string; value: string }[];
  link: string;
};

/**
 * What the printable product sheet shows: the large image (or none), the
 * formatted price ("Price unavailable" when there isn't one), the stock text,
 * at most 8 highlights and 12 specs, and the full product link on `origin`.
 */
export function sheetFields(p: Product, origin: string): SheetFields {
  return {
    name: p.name,
    brand: p.brand,
    image: p.images[0] ?? (p.image ? imageAt(p.image, 1000) : null),
    price: money(p.price, p.currency),
    stock: p.inStock ? "In stock" : "Out of stock",
    inStock: p.inStock,
    highlights: p.highlights.slice(0, SHEET_HIGHLIGHTS),
    specs: p.specs.slice(0, SHEET_SPECS),
    link: `${origin.replace(/\/+$/, "")}/p/${encodeURIComponent(p.id)}`,
  };
}
