# Security Review — Seat Reservation
## CRITICAL (Must Fix)
1. JWT and CSRF tokens leaked in URL — `packages/api/src/routes/auth.ts:150-151`

```typescript
return redirect(`${config.webUrl}?token=${token}&csrf=${csrfTokens.header}`);
```

Tokens passed as query params in the OAuth redirect URL. Exposed in: browser history, server logs, Referer header, bookmarks. JWT is a long-lived credential (90 days).

Fix: Use postMessage or server-side session exchange instead of URL parameters.

2. POST /auth/mock-login has no production guard — `packages/api/src/routes/auth.ts:213-276`

Anyone who discovers this endpoint can authenticate as any user by providing `{ email, name }`. No NODE_ENV check, no IP whitelist, no feature flag. This is a backdoor.

Fix: Early-return if `config.nodeEnv === "production"`:
```typescript
if (config.nodeEnv === "production") return ResponseBuilder.notFound();
```

3. CSRF validation is a length check, not a cryptographic comparison — `packages/api/src/utils/csrf.ts:68-69`

```typescript
const isValid = token.length === this.secretLength && cookie.length === this.secretLength;
```

Any two 32-char strings pass. The CSRF protection is effectively non-functional.

Fix: Compare the actual token values:
```typescript
const isValid = token === cookie;
```

Use constant-time comparison if the production threat model requires it.
## HIGH (Important)
4. Credit card data collected in plaintext over HTTP — `packages/api/src/routes/seats.ts:233-331`, `packages/web/src/App.tsx:276-284`

cardNumber, expiry, and cvv are sent as JSON in the POST body to /seats/:id/reserve. No TLS. The backend validates format but never processes with a real payment gateway. If put in production, this violates PCI-DSS.

Fix: If this is a demo, add a warning banner saying "no real payment data". For production, integrate Stripe Elements (never let raw card data touch your server).

5. Math.random() used for API key generation — `packages/api/src/routes/keys.ts:19-27`

```typescript
result += chars.charAt(Math.floor(Math.random() * chars.length));
```

Math.random() is not cryptographically secure. API keys are high-value credentials.

Fix: Use crypto.randomBytes instead:
```typescript
import { randomBytes } from "crypto";
const bytes = randomBytes(24);
```

6. JWT cookie httpOnly: false in primary auth flow — `packages/api/src/routes/auth.ts:127`

```typescript
cookie.token.set({ value: token, httpOnly: false, ... });
```

Any XSS vulnerability grants full token access.

Fix: Set httpOnly: true.
## MEDIUM
7. Auth rate limiter uses hardcoded IP — `packages/api/src/routes/auth.ts:60`

```typescript
const clientIP = "127.0.0.1";
```

All auth callback requests share the same rate-limit bucket. The limiter is effectively disabled.

Fix: Read from x-forwarded-for or x-real-ip headers (already done in index.ts:59-62).

8. XSS in token-setter.html — `packages/web/public/token-setter.html:203-206`

```javascript
status.innerHTML = `... User ID: ${payload.id}<br>Email: ${payload.email}...`;
```

Decoded JWT payload fields injected via innerHTML without sanitization.

Fix: Use textContent instead of innerHTML.

9. Auth tokens in localStorage — `packages/web/src/App.tsx:9`, `App.tsx:164`, `token-setter.html:200`

JWTs in localStorage are accessible to any script on the same origin (XSS-readable).

Fix: Prefer httpOnly cookies with a short-lived access token + refresh token pattern. For the current localStorage pattern, ensure no XSS vectors exist.

10. No HTTP security headers

Neither the API nor the web app sets:
- Content-Security-Policy
- Strict-Transport-Security
- X-Frame-Options (DENY)
- X-Content-Type-Options (nosniff)

Fix: Add helmet-style middleware or Rsbuild headers config:
```typescript
// Elysia
app.onBeforeHandle(({ set }) => {
  set.headers["X-Content-Type-Options"] = "nosniff";
  set.headers["X-Frame-Options"] = "DENY";
  set.headers["Content-Security-Policy"] = "default-src 'self'";
});
```

11. CORS disabled in production — `packages/api/src/index.ts:36`

```typescript
origin: config.nodeEnv !== "production",
```

When origin: false, CORS is disabled entirely.

Fix: Configure explicit allowed origins or document the proxy requirement.

12. dist/server committed to git

Binary build output is tracked in the repository.

Fix: Add to .gitignore.

13. No request body size limits

No maxBodySize configured on Elysia.

Fix: Add `maxBodySize: 1024 * 1024` (1MB) to Elysia config.
## LOW
14. JWT signed without explicit exp — `packages/api/src/routes/auth.ts:116-119`

The token's expiry relies on @elysiajs/jwt's default (potentially infinite). The cookie has maxAge: 90 days but the JWT itself may not expire.

Fix: Pass exp in the JWT payload:
```typescript
jwt.sign({ id: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + JWT_EXPIRATION });
```

15. 5 route files defined but never imported in index.ts
- routes/tasks.ts
- routes/worklogs.ts
- routes/keys.ts
- routes/agent.ts
- routes/auth-elysia.ts
- routes/users-elysia.ts

Dead code increases attack surface and maintenance burden.

16. Duplicate validation schemas — validation.ts vs elysia-validation.ts with slight differences.

17. 3 unused runtime dependencies: isomorphic-dompurify, react-markdown, remark-gfm. Unused packages add supply chain risk.
## INFO
| Finding | Detail |
|---|---|
| No HTTPS | Listens on plain HTTP, no TLS config |
| No migration system | Schema is CREATE TABLE IF NOT EXISTS on startup |
| ioredis installed but unused | Redis for rate limiting never wired |
| Rate limiter is in-memory | Resets on server restart |
| tokenExpiry unused | Parsed in constructor, never checked in validateToken |
| No integration tests | All tests are unit tests with mocked deps |
| User picture rendered without validation | OpenApiExample.tsx renders user.picture from API in img src |
## Recommendations (Priority Order)
1. Remove mock-login from production — highest-impact, single-line fix
2. Fix CSRF validation — currently a no-op security control
3. Remove URL token leak — switch to postMessage or server-side session
4. Use crypto.randomBytes for API keys
5. Add CSP + HSTS headers
6. Delete dead route files
7. Add PCI-DSS compliance warning to card input UI if demo
## Assessment
This is a prototype/demo application with security controls that are partially implemented but have critical gaps. The mock-login backdoor and URL token leak are the most urgent issues. The CSRF protection, rate limiting, and crypto randomness are all non-functional and should either be made functional or removed (security theater is worse than no security).
## Resolution Status
All findings from this review have been resolved across three rounds of fixes:

| # | Finding | Status | Fix |
|---|---|---|---|
| 1 | JWT/CSRF tokens leaked in OAuth redirect URL | ✅ Resolved | Tokens now set as httpOnly cookies server-side; JavaScript reads `csrf-token` cookie from `document.cookie` |
| 2 | mock-login has no production guard | ✅ Resolved | Early return `config.nodeEnv === "production"` → 404 |
| 3 | CSRF validation is length-only check | ✅ Resolved | Changed to exact string comparison (`token === cookie`) |
| 4 | Credit card data in plaintext | ✅ Resolved | Warning banner added ("not real payment data"); `demo: true` flag in config |
| 5 | Math.random() for API keys | ✅ Resolved | Replaced with `crypto.randomBytes(24)` |
| 6 | JWT cookie httpOnly: false | ✅ Resolved | Changed to `httpOnly: true` |
| 7 | Auth rate limiter hardcoded IP | ✅ Resolved | Now reads from `x-forwarded-for` / `x-real-ip` headers |
| 8 | XSS in token-setter.html | ✅ Resolved | Replaced `innerHTML` with `textContent` |
| 9 | Auth tokens in localStorage | ✅ Resolved | Moved to httpOnly cookies (JWT + refresh token pattern) |
| 10 | No HTTP security headers | ✅ Resolved | CSP, HSTS, X-Frame-Options, X-Content-Type-Options added |
| 11 | CORS disabled in production | ✅ Resolved | Explicit origin configuration; documented proxy requirement |
| 12 | dist/server committed | ✅ Resolved | Added to `.gitignore` |
| 13 | No request body size limit | ✅ Resolved | `maxBodySize: 1MB` configured |
| 14 | JWT without explicit exp | ✅ Resolved | `exp` claim set to 1 hour; refresh token provides 90-day session |
| 15 | Dead route files | ✅ Resolved | Unused route files removed; `elysia-validation.ts` deleted |
| 16 | Duplicate validation schemas | ✅ Resolved | `elysia-validation.ts` removed; single `validation.ts` source of truth |
| 17 | Unused runtime dependencies | ✅ Resolved | `isomorphic-dompurify`, `react-markdown`, `remark-gfm` removed |
### Round 3: Distributed Microservices Security Improvements
In addition to the initial monolith security patches, we transformed the system into a distributed architecture, securing key context boundaries:
- Opaque Refresh Token Family Tracking & Reuse Detection: Refresh tokens are random opaque strings stored as SHA-256 hashes in `auth_db`. On refresh, old tokens rotate. Reuse of a previously rotated token invalidates the entire family group to prevent token hijacking.
- Refresh Rotation Grace Window: A 10-second window is enabled to allow rotated refresh tokens to be re-sent once, ensuring network reconnect retries do not trigger accidental user lockouts.
- Access Token Blacklist Invalidation: Bumping `token_version` on a user during logout immediately invalidates all active Access Token JWTs across all services by verifying versions against a fast Redis cache.
- Timing-Safe Webhook Signatures: The payment webhook endpoint computes SHA-256 HMACs using `crypto.timingSafeEqual` and checks timestamp age (rejecting payloads older than 5 minutes) to protect against timing attacks and replay forgery.
- Gateway Rate Limiting Zones: Rate-limiting zones are managed on the Nginx gateway (`limit_req_zone`), rejecting brute-force login and checkout floods before hitting application runtimes.
- Server-Controlled Checkout Amounts: Pricing maps are resolved on the backend from cached seats tables in `payment_db`, preventing client payload price spoofing.
