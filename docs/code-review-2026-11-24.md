# Code Review & Improvements — 2026-11-24

Full-monorepo review of `packages/api`, `packages/be-core`, `packages/contracts`,
`packages/web`, `apps/{auth,seat,payment}-service`, `infra/`, `scripts/`, and
`migrations/`. All changes are committed on `main`:

| Commit | Scope |
|---|---|
| `2cfad9d` | Review pass — hook ordering, token/session bugs, SSE leak, type configs |
| `5d20b66` | Repair env/migration scripts, drop unused compose env vars |
| `6530186` | Cross-service token revocation and CSRF on service mutations |
| `55060a0` | Atomic rate-limit window and webhook payload guards |

Verification: `bun test` (packages/api) 77/77 pass, `tsc -b` clean for
be-core/contracts/web, `rsbuild build` succeeds, biome clean on touched files.

---

## Critical fixes

### Elysia hook ordering (all services)

Elysia hooks are **positional** — they only apply to routes registered *after*
them. In `packages/api/src/index.ts` and all three service `index.ts` files,
route plugins were `.use()`d before `.derive`/`.onBeforeHandle`/`.onError`, so
the general rate limiter, security headers, and global error handler applied to
nothing but `/`.

Fix: hooks are now registered **before** route plugins everywhere. Verified
live: `/seats` returns `X-Frame-Options`, CSP, HSTS, etc.

### Auth/session bugs (`apps/auth-service`)

- **Refresh-token grace window** measured `created_at` (token age) instead of
  revocation time — legit retries were treated as theft and revoked the whole
  family. Now joins the successor token (`rotated_to`) for real rotation time.
- **`/logout`** bumped `token_version` and revoked *all* refresh tokens —
  identical to `/logout-all`. Now revokes only the presented token's family
  via `revokeTokenFamilyByRawToken` (each login starts a new family).
- **`config.ts`** required `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI` that the
  service never uses (Google OAuth lives in `packages/api`) — it wouldn't boot
  without them. Removed; compose env vars dropped to match.

### Seat service (`apps/seat-service`)

- **SSE `/stream` leak** — subscriber cleanup was `return`ed from `start()`,
  which the Streams API ignores; every disconnect leaked a Redis subscriber +
  heartbeat interval, and `enqueue` after close could throw inside
  `setInterval`. Rewritten with a proper `cancel()` handler and guarded enqueue.
- **`Retry-After`** crashed to `NaN` when `held_until` was null — now falls back
  to `config.holdTtlSeconds`.
- **`payment.completed` consumer** inserted a reservation even when the seat
  `UPDATE` matched 0 rows (expired/taken hold), corrupting state. Now checks
  `payment_intent_id` idempotency first and throws on `rowCount === 0` so the
  tx rolls back and Kafka redelivers.

### Payment service (`apps/payment-service`)

- **Webhook handler** now validates `id`/`type` are non-empty strings before
  inserting into `webhook_inbox`.
- **Inbox worker** acknowledges unhandled Stripe event types as `DONE`
  immediately (previously any event without `data.object.metadata` threw,
  retried 5×, and landed in `DEAD`), and validates payload shape
  (`data.object.id`/`amount`/`metadata.seatId`/`userId`) before processing.

### `packages/api`

- **Refresh rotation** now deletes old + inserts new in one transaction —
  previously a mid-flight failure logged the user out.
- **`findOrCreateUser`** falls back to re-select on unique-constraint insert
  failure (concurrent first logins).
- Removed `tokens.id_token!` non-null assertion with a proper guard.
- Rate-limit warn logged `clientIP: rateLimitResult` (wrong object) — fixed.
- Typed `CookieJar`/`CookieSetter` replaced `Record<string, any>`; removed
  unused `request` param.

### `packages/be-core`

- **`KafkaConsumer`** assigned `this.connected` without declaring the field —
  removed dead field/assignments.
- **`authMiddleware`** now actually enforces `tokenVersion` when a
  `tokenVersionLookup` is configured (was documented but never checked).
- **Rate limiter** replaced `INCR`+conditional `PEXPIRE` pipeline with a Lua
  script — a crash between commands could leave a key with no expiry and
  rate-limit an identifier permanently.
- **New `csrf.ts`**: `CSRFProtection` (signed double-submit cookie) moved here
  from `packages/api` so all services share it; secret is injected.
- **New `publishTokenVersion`/`getCachedTokenVersion`**: publish the user's
  `token_version` to shared Redis (`tv:{userId}`) so sibling services can
  reject revoked tokens.

---

## Cross-service token revocation + CSRF (`6530186`)

- **auth-service** publishes `tokenVersion` to Redis on every token issuance
  and publishes the *bumped* version on `logout-all` (previously it deleted the
  cache key, which siblings couldn't interpret).
- **seat/payment services** compare `payload.tokenVersion` against the Redis
  value after JWT verify — mismatch → 401 "Session has been revoked". Missing
  key → allowed (documented degradation; converges within one refresh cycle).
- **auth-service** enforces `token_version` in `/auth/me` and `/users/me`
  against the DB — previously even the auth service ignored the claim.
- **CSRF**: auth-service mints the `csrf-token` cookie and returns the
  `csrfToken` signature on login/register/mock-login/refresh/me — same contract
  as `packages/api`, so the existing frontend works unchanged. Enforced on
  seat hold/release, payment reserve, `/refresh`, `/logout`, `/logout-all`,
  `PATCH /users/me`. CORS `allowedHeaders` updated in seat/payment.

## Tooling / config fixes

- **`scripts/copy-envs.ts` + `scripts/run-migrations.ts`** used `__dirname`
  under `"type": "module"` — crashed with `ReferenceError`. Now
  `import.meta.dirname`.
- **`packages/api/scripts/generate-jwt.ts`** curl example hit nonexistent
  `/tasks`; now `/users/me` (accepts Bearer tokens).
- **TS project references**: `tsconfig.base.json` `noEmit: true` conflicts
  with composite referenced projects (TS6310 cascade across all apps).
  `packages/api`, `be-core`, `contracts`, `web` now emit declarations only to
  gitignored `dist/`; built with `tsc -b`.
- **`packages/contracts`**: removed spurious `references: [{path: "../api"}]`
  and unused `@bed-stack/api` devDependency blocking declaration builds.
- **`packages/web`**: `OpenApiExample.tsx` imported nonexistent functions —
  rewritten against real APIs (`getAuthStatus`, `updateCurrentUser` with
  `x-csrf-token`, direct redirect to `/auth/google`). `queries.ts` unused type
  aliases removed; duplicate `noEmit` key removed.
- **`docker-compose.yml`**: dropped unused `GOOGLE_*` env vars from
  auth-service.

---

## Known remaining issues (not fixed)

- **~40 pre-existing Elysia context-typing errors** in `packages/api` and the
  apps (`jwt`/`cookie` not in inferred handler context, `maxBodySize` config,
  Bun `Request`/`Response` types). Runtime unaffected — Bun doesn't typecheck.
- **Redis `retryStrategy` gives up after 10 attempts** — a long Redis outage
  leaves clients disconnected while the app keeps running (rate limiter fails
  open; `tv:` lookups may error → 500s on guarded routes).
- **Sweeper** releases expired holds without emitting `seat.released` outbox
  events — frontend polls every 4s so UX is fine, but Kafka consumers don't
  see sweep releases.
- **`packages/api`** in-memory rate limiter has unused
  `skipSuccessfulRequests`/`skipFailedRequests` options; seat lock allows one
  user to hold multiple seats (services enforce 1 via partial unique index —
  intentional difference between the two variants).
- **`packages/api`** `clearExpiredLocks` hardcodes 5 min, matching the
  frontend's hardcoded `5 * 60 * 1000` — consistent but duplicated.
- **`packages/api` `refreshTokens`** table has no index on `token_hash`.
- **Access tokens issued before `6530186`** lack a published `tokenVersion`
  until next refresh — the check skips unknown versions, so nothing breaks and
  revocation converges within one refresh cycle.

## Notes

- `docs/security-review.md` documents older issues (JWT in URL redirect,
  unguarded mock-login) — both are already fixed in current code; the doc is
  stale relative to `main`.
