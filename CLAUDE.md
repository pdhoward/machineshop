# Machine Shop — working rules

A small demonstration store: ~10,000 home and workshop products from MongoDB, browse, ask, and Buy now through Stripe test mode (one product per order, no cart; Stripe keeps the orders). It is the Accelerator's first test customer, so keep it small, clear and tested.

## Layout
- `lib/product.ts` — pure mapping from raw catalog documents to `ProductCard` / `Product`. Unit tested (`lib/product.test.ts`).
- `lib/catalog.ts` — **the only code that talks to the catalog database**, and it is **read-only**. Pages and the assistant call its functions.
- `lib/voice-store.ts` — **the only code that talks to the separate voice database** (call sessions, wrong-code attempts, 30-day transcripts). Unit tested with fake collections (`lib/voice-store.test.ts`).
- `lib/checkout.ts` — pure Buy now rules: who can buy (price, in stock, USD), amount in cents, US-only flat-rate shipping ($9.95), the test-key check and the Stripe Checkout fields. Unit tested (`lib/checkout.test.ts`).
- `lib/stripe.ts` — **the only code that talks to Stripe**, plain `fetch`, test keys only. Creates checkouts and reads a paid one for the confirmation page without the address or email. Unit tested with `fetch` mocked.
- `app/api/checkout` — Buy now: a form POST with the product ID only; the server loads the product from the catalog and redirects to Stripe. Route tested with the catalog and `fetch` mocked.
- `app/order/success` — "Order received": product, total and Stripe reference, never the address; noindex.
- `app/page.tsx` — storefront: departments, search, paging. `app/p/[id]` — product page.
- `app/api/assistant` — the shop assistant (Claude with tools over `lib/catalog.ts`).
- `app/api/voice/session` — Talk mode's call session: status, start (code gate, lockout, cooldown, one-call OpenAI pass, signed token) and end. Route tested with the store and `fetch` mocked.
- `app/api/voice/owner` + `app/owner/transcripts` — the owner's private list of saved calls (last 30 days, 20 per page) behind `VOICE_OWNER_CODE` and a signed httpOnly cookie; noindex. Wrong codes share Talk's lockout (`lib/voice-caller.ts`). Route tested with the store mocked.
- `components/` — UI. Colors are CSS tokens in `app/globals.css` (light + dark); use them, don't hardcode colors.

## Rules
- Never write to the catalog. No inserts, updates, deletes or index changes.
- `lib/voice-store.ts` is the only code that writes, and only to the voice database (`VOICE_MONGODB_URI` / `VOICE_MONGODB_DB`, its own login, never `MONGODB_URI`). The catalog stays read-only. Store device and network IDs only as HMACs with `VOICE_SECRET`, never raw IPs, and limit or paginate every voice query.
- New data needs go through a function in `lib/catalog.ts`; parsing/cleanup goes in `lib/product.ts` with a test.
- Always paginate or limit queries; the collection has 10,000+ documents.
- The assistant may only mention products its tools returned. Keep `max_tokens` and the turn limit.
- OpenAI is allowed for voice (Talk mode) only, called from the server with plain `fetch`. Typed chat stays on Claude. `OPENAI_API_KEY` never leaves the server; the browser gets only a short-lived one-call pass.
- The voice assistant keeps its output token cap (`VOICE_MAX_OUTPUT_TOKENS` in `lib/voice.ts`) and the 5-minute call limit, enforced on the server as well as the browser.
- Stripe is test mode only: `STRIPE_SECRET_KEY` must be a `sk_test_`/`rk_test_` key, and the server refuses anything else. Never add live keys or live payments.
- The checkout price always comes from the catalog via `lib/checkout.ts`, never from the browser. One product, quantity 1.
- The site stores no orders, addresses or card details; Stripe keeps them. `lib/stripe.ts` returns no address or email to pages.
- Configuration is environment variables only, listed in `.env.example` with where to find each value. Never commit values.
- Before finishing: `pnpm typecheck`, `pnpm test`, `pnpm build`.
