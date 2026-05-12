# E2E tests with real Postgres

These tests run **real SQL** against a dedicated test database. They are
skipped automatically when `TEST_DATABASE_URL` is not set, so they do not
break the default `npm test` flow.

## Setup

1. Spin up a clean Postgres database for testing (separate from dev):

   ```bash
   createdb fanflow_test
   # or via docker:
   docker run -d --name fanflow-test-db -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:16
   ```

2. Export the connection URL and run migrations against it:

   ```bash
   export TEST_DATABASE_URL="postgresql://postgres:test@localhost:5433/fanflow_test"
   DATABASE_URL=$TEST_DATABASE_URL npm run db:migrate
   ```

3. Run the E2E suite:

   ```bash
   TEST_DATABASE_URL="..." npx vitest run __tests__/e2e
   ```

## Test isolation

Every test wraps its work in a transaction that is **rolled back** on
teardown. The test DB stays clean across runs and tests can execute in
parallel without colliding.

Helpers in `_helpers.ts`:
- `getTestDb()` — returns the shared Drizzle client (skip-friendly).
- `withTx(fn)` — runs `fn` inside a transaction that always rolls back.
- `seedCreator()` — quick fixture for a creator + active subscription.

## What's covered

- `comments-ingest.e2e.test.ts` — REST POST /api/v1/comments style flow:
  link-or-create author, dedup by externalCommentId, counter updates.
- `scheduler-create.e2e.test.ts` — full scheduledPosts insert + lookup,
  including multi-account accountId resolution.
- `moderation-delta.e2e.test.ts` — setModerationStatus adjusting
  unhandledCount correctly across state transitions.
- `oauth-flow.e2e.test.ts` — oauth_pending_flows insert + expiration
  semantics.

## What's NOT covered (deliberately)

- HTTP layer (those are middleware/route tests with mocks).
- BullMQ enqueue (mocked).
- AI calls (mocked).
- External APIs (Reddit, Twitter, IG — mocked).

These E2E tests validate DB-level invariants that the unit tests can't
cover with module-level mocks (foreign keys, unique constraints, triggers,
generated columns when they appear).
