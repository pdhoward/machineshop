# Machine Shop — working rules

A small demonstration store: ~10,000 home and workshop products from MongoDB, browse and ask only (no cart, no orders). It is the Accelerator's first test customer, so keep it small, clear and tested.

## Layout
- `lib/product.ts` — pure mapping from raw catalog documents to `ProductCard` / `Product`. Unit tested (`lib/product.test.ts`).
- `lib/catalog.ts` — **the only code that talks to MongoDB**, and it is **read-only**. Pages and the assistant call its functions.
- `app/page.tsx` — storefront: departments, search, paging. `app/p/[id]` — product page.
- `app/api/assistant` — the shop assistant (Claude with tools over `lib/catalog.ts`).
- `components/` — UI. Colors are CSS tokens in `app/globals.css` (light + dark); use them, don't hardcode colors.

## Rules
- Never write to the catalog. No inserts, updates, deletes or index changes.
- New data needs go through a function in `lib/catalog.ts`; parsing/cleanup goes in `lib/product.ts` with a test.
- Always paginate or limit queries; the collection has 10,000+ documents.
- The assistant may only mention products its tools returned. Keep `max_tokens` and the turn limit.
- Configuration is environment variables only, listed in `.env.example` with where to find each value. Never commit values.
- Before finishing: `pnpm typecheck`, `pnpm test`, `pnpm build`.
