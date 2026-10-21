# Work #9: Add ecommerce capability to the site using Stripe

Site: Machine Shop · Complexity: High · Stage: prove · Branch: `work/9-add-ecommerce-capability-to-the-site-usi`

> Written by the Accelerator's Librarian at Prove. It records what was agreed, decided and proven. Edit the item in the Control Room, not here.

## Design (v1, approved 2026-10-21)

Here is the design. You did not answer my three questions, so the design uses my recommendations. Each one is marked **Assumption**. To change one, tell me before you approve.

**Design: Buy now with Stripe (test mode), Work item #9**

**Outcome.** A shopper opens a product, selects "Buy now" and pays on Stripe's checkout page with a test card. Stripe records the order and the shipping address. You see each order in the Stripe test dashboard and ship it from there.

**What the shopper sees**
1. The product page shows a "Buy now" button next to "Ask about this product".
2. The button shows only when the product has a price, is in stock, and is priced in US dollars.
3. Stripe's page asks for the shipping address and card, and shows the flat shipping charge.
4. After payment, the shopper sees an "Order received" page with the product, the total and the Stripe order reference.
5. If the shopper cancels, Stripe sends them back to the product page.
6. The line "browse and ask, no checkout" becomes "Test store: payments use Stripe test mode. No real charges."

**Assumptions (please confirm)**
1. **One product per order, quantity 1.** No cart.
2. **US shipping addresses only, one flat rate.** I propose $9.95. Tell me your rate.
3. **Stripe holds the orders.** The site keeps no orders database and stores no addresses.

**Safety rules in the design**
- The server reads the price from the catalog. It never accepts a price from the browser.
- The site uses a Stripe test key only. The server refuses to create a checkout with a live key.
- Card details go only to Stripe. The "Order received" page shows no address.
- The catalog stays read-only. The design adds no database writes.
- If the Stripe key is missing, the "Buy now" button does not show and the store works as it does now.

**Out of scope for this Work item**
Cart, sales tax, stock reduction, refunds, order emails, an orders page on the site, live payments, and buying through the shop assistant. Each one can start later as a new improvement.

**Acceptance criteria**
1. A test-card payment for a priced product creates a paid order with a US address in the Stripe test dashboard.
2. The order total equals the catalog price plus the flat shipping rate.
3. Products with no price, out-of-stock products and non-USD products show no "Buy now" button.
4. A changed price or product ID sent from the browser cannot change the charged amount.
5. A live Stripe key causes the server to refuse checkout.
6. Typecheck, the full test suite and the build pass.

**Plan (4 builder steps)**
1. Add the checkout rules: who can buy, the amount in cents, US-only shipping, the flat rate, and the test-key check. Unit tests prove each rule.
2. Add the server checkout route. It looks up the product in the catalog and creates the Stripe checkout. Route tests run with Stripe mocked.
3. Add the "Buy now" button, the "Order received" page and the cancel return. Tests cover when the button shows.
4. Update the store notice, `.env.example` and the CLAUDE.md rule "no cart, no orders".

**What I need from you before the build**
- **Approve the design**, or change an assumption. This approval lets the crew add test-mode Stripe payments and change the store's "browse and ask only" rule. It does not allow live payments.
- **Add a Stripe test secret key** (it starts with `sk_test_`) to the Vercel Preview settings as `STRIPE_SECRET_KEY`. The crew cannot read or add keys. Without the key, the preview shows no "Buy now" button.

COMPLEXITY: high
READY: yes
REASON: Design written with stated assumptions; payments and shopper addresses need the Owner's approval before the build.

## Plan

1. Add the checkout rules (done)
2. Add the Stripe client and the checkout route (done)
3. Add the Buy now button, the Order received page and the cancel return (done)
4. Update the store notice, .env.example and CLAUDE.md (done)

## Decisions

| When | Decision | By | How | On |
|---|---|---|---|---|
| 2026-10-21 17:17 | tier | patrick.howard | button | high |
| 2026-10-21 17:19 | approve_design | patrick.howard | button | design v1 |
| 2026-10-21 17:21 | approve_plan | patrick.howard | button | plan of 4 steps |

## Evidence

| When | Check | Result | Tests | Commit |
|---|---|---|---|---|
| 2026-10-21 17:23 | step_checks | pass | 252/252 | `16cb20fe` |
| 2026-10-21 17:25 | step_checks | pass | 269/269 | `c0bcacd1` |
| 2026-10-21 17:27 | step_checks | pass | 274/274 | `3b35417e` |
| 2026-10-21 17:28 | step_checks | pass | 276/276 | `c9c6e39d` |
