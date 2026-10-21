# Work #8: add a test to the home page

Site: Machine Shop · Complexity: Medium · Stage: prove · Branch: `work/8-add-a-test-to-the-home-page`

> Written by the Accelerator's Librarian at Prove. It records what was agreed, decided and proven. Edit the item in the Control Room, not here.

## Brief (v1, approved 2026-10-21)

### Home page test: prove the storefront opens

#### Summary
The Builder adds an automatic test. It proves that the storefront home page (`app/page.tsx`) opens and shows its main content. If a later change breaks the home page, the test fails before that change gets to the preview.

#### What changes
- The Builder adds one test file, `app/page.test.tsx`. It sits next to the page, the same way the route tests sit next to their routes.
- The test opens the home page in the test run and turns it into HTML. The test uses React's own server renderer, which the site already has, so it adds no new tool.
- The test replaces the catalog with a small set of fake products and departments. This is the same method `lib/voice.test.ts` and `lib/assistant-tools.test.ts` use.
- The test checks three cases:
  1. **Home page, no search:** The page opens. It shows the heading "Everything for the build.", the product count, the "All" department chip and the product cards.
  2. **Catalog not set up:** The page shows the setup notice and does not fail.
  3. **Search with no results:** The page shows "Nothing matches that" and the "Ask the assistant" button.
- If the test runner cannot read the page's markup, the Builder adds one setting line to `vitest.config.ts`. Today the runner reads only plain TypeScript files.

#### What stays protected
- The home page does not change. Its look, its text, its links and its paging stay the same.
- The test never connects to the catalog database or the voice database. It never reads `.env` files or keys.
- The catalog stays read-only. `lib/catalog.ts` does not change.
- All current tests stay and still pass (`lib/*.test.ts`, `app/api/voice/**/route.test.ts`).

#### How we'll prove it
- The new test opens the home page with fake catalog data and finds the main heading and product cards.
- The new test opens the home page with no catalog set up and finds the setup notice.
- The new test opens a search with no results and finds the "Nothing matches that" message.
- `pnpm typecheck`, `pnpm test` and `pnpm build` pass on the exact candidate.
- The Navigator opens the preview link and sees the home page as before.

#### Risks and open questions
- **Test in code, or a check on the live preview?** I recommend the test in code. It runs on every change and never touches real catalog data. A check on the live preview would read the real database, and this Brief does not cover that.
- **Unknown:** The page uses `next/link`, and I do not yet know if it works outside Next.js in the test run. The Builder's first test run answers this. If it fails, the test replaces `next/link` with a plain link. The page itself stays the same.
- **Platform:** The earlier runs failed because the platform had no "stage" branch. This run created its workspace, so that problem seems fixed. The next run will confirm it.

## Plan

1. Add app/page.test.tsx: the home page opens with fake catalog data (done)

## Decisions

| When | Decision | By | How | On |
|---|---|---|---|---|
| 2026-10-21 12:55 | approve_brief | patrick.howard | typed | brief v1 |
| 2026-10-21 12:55 | approve_plan | Medium: the plan is the crew's | policy | plan of 1 steps |

## Evidence

| When | Check | Result | Tests | Commit |
|---|---|---|---|---|
| 2026-10-21 12:57 | step_checks | pass | 243/243 | `edbb3c66` |
