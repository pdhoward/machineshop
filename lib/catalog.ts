import "server-only";

import { MongoClient, ObjectId, type Collection, type Filter } from "mongodb";

import { toCard, toProduct, type ProductCard, type RawProduct } from "./product";

/**
 * The catalog: the only code that touches MongoDB, and read-only.
 * Pages, the assistant and anything added later go through these functions.
 */

export const PAGE_SIZE = 24;

/** A catalog document as MongoDB returns it. */
type Doc = Omit<RawProduct, "_id"> & { _id: ObjectId };

export const catalogConfigured = () => !!process.env.MONGODB_URI;

// One client per server process (kept across hot reloads in dev).
const g = globalThis as unknown as { mongo?: Promise<MongoClient> };

async function products(): Promise<Collection<Doc>> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set.");
  g.mongo ??= new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 }).connect();
  const client = await g.mongo;
  return client.db(process.env.MONGODB_DB || "openai").collection<Doc>(process.env.MONGODB_COLLECTION || "product");
}

const CARD_FIELDS = {
  name: 1, images: 1, description: 1, overview: 1, brand: 1, price: 1, currency: 1, in_stock: 1, breadcrumbs: 1, avg_rating: 1, total_reviews: 1,
} as const;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type Query = { q?: string; category?: string; maxPrice?: number; minPrice?: number; inStockOnly?: boolean; sort?: Sort };
/** The orders every catalog offers; unset keeps the catalog's own order. */
export type Sort = "price_asc" | "price_desc" | "rating";
const SORTS = { price_asc: { price: 1, _id: 1 }, price_desc: { price: -1, _id: 1 }, rating: { avg_rating: -1, _id: 1 } } as const;

function filterFor({ q, category, maxPrice, minPrice, inStockOnly }: Query): Filter<Doc> {
  const and: Filter<Doc>[] = [];
  const words = (q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  // Every word must appear in the name, brand or category trail.
  for (const w of words) {
    const re = { $regex: escape(w), $options: "i" };
    and.push({ $or: [{ name: re }, { brand: re }, { breadcrumbs: re }] });
  }
  if (category) and.push({ breadcrumbs: { $regex: `^${escape(category)}`, $options: "i" } });
  if (maxPrice != null || minPrice != null) {
    and.push({ price: { ...(minPrice != null && { $gte: minPrice }), ...(maxPrice != null && { $lte: maxPrice }) } });
  }
  if (inStockOnly) and.push({ in_stock: { $ne: "FALSE" } });
  return and.length ? { $and: and } : {};
}

export async function search(query: Query, page = 1, size = PAGE_SIZE): Promise<{ items: ProductCard[]; total: number }> {
  const col = await products();
  const filter = filterFor(query);
  const [docs, total] = await Promise.all([
    col.find(filter, { projection: CARD_FIELDS }).sort(query.sort ? SORTS[query.sort] : { _id: 1 }).skip((page - 1) * size).limit(size).toArray(),
    col.countDocuments(filter),
  ]);
  return { items: docs.map(toCard), total };
}

export async function product(id: string) {
  if (!ObjectId.isValid(id)) return null;
  const doc = await (await products()).findOne({ _id: new ObjectId(id) });
  return doc ? toProduct(doc) : null;
}

export async function cardsByIds(ids: string[]) {
  const valid = ids.filter((id) => ObjectId.isValid(id)).slice(0, 12);
  if (!valid.length) return [];
  const docs = await (await products())
    .find({ _id: { $in: valid.map((id) => new ObjectId(id)) } }, { projection: CARD_FIELDS })
    .toArray();
  const byId = new Map(docs.map((d) => [d._id.toString(), toCard(d)]));
  return valid.map((id) => byId.get(id)).filter((c): c is ProductCard => !!c);
}

// Top-level departments (first breadcrumb) with counts; changes rarely, so cached for 30 minutes.
type Department = { name: string; count: number };
let departments: { at: number; list: Promise<Department[]>; good?: Department[]; refreshing?: boolean } | null = null;

/**
 * The top departments (an aggregation over the whole catalog). Cached for 30
 * minutes; after that the last list still serves at once while a fresh one is
 * computed (stale-while-revalidate), so no request waits on the aggregation
 * except an instance's very first.
 */
export function listDepartments(): Promise<Department[]> {
  const cur = departments;
  if (cur && Date.now() - cur.at < 30 * 60_000) return cur.list;
  if (cur?.good) {
    if (!cur.refreshing) {
      cur.refreshing = true;
      // The old list stays in place until the new one has arrived, so no request waits on the aggregation.
      aggregateDepartments().then(
        (l) => void (departments = { at: Date.now(), list: Promise.resolve(l), good: l }),
        () => Object.assign(cur, { at: Date.now() - 25 * 60_000, refreshing: false }), // try again in 5 minutes
      );
    }
    return Promise.resolve(cur.good);
  }
  // An instance's first read: wait for it.
  const list = aggregateDepartments();
  const entry: NonNullable<typeof departments> = { at: Date.now(), list };
  departments = entry;
  list.then(
    (l) => (entry.good = l),
    () => departments === entry && (departments = null),
  );
  return list;
}

function aggregateDepartments(): Promise<Department[]> {
  return products().then((col) =>
    col
      .aggregate<{ _id: string; count: number }>([
        { $match: { breadcrumbs: { $type: "string", $ne: "" } } },
        { $group: { _id: { $trim: { input: { $arrayElemAt: [{ $split: ["$breadcrumbs", ","] }, 0] } } }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 24 },
      ])
      .toArray()
      .then((rows) => rows.filter((r) => r._id).map((r) => ({ name: r._id, count: r.count }))),
  );
}
