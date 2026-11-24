# Distributed Seat Reservation System — API Specification (OpenAPI 3.0)
This document provides a detailed API specification for all gateway-exposed routes in the seat reservation microservices system.

The gateway (Nginx) listens on port `3000` and aggregates all requests under the `/api` prefix, rewriting paths and routing them to their respective bounded-context microservices.

## 1. Global Concepts & Contexts
### Base URL
All client requests must target the gateway:
```text
http://localhost:3000/api
```
### Rate Limiting (Managed by Nginx Gateway)
* Auth Zone (`auth_zone`): `10 requests/minute` per IP max (for `/api/auth/login` and `/api/auth/register`), with a burst of `5`. Returns `429 Too Many Requests`.
* Payment Zone (`payment_zone`): `15 requests/minute` per IP max (for `/api/seats/:id/reserve`), with a burst of `5`. Returns `429 Too Many Requests`.
* General API Zone (`general_zone`): `10 requests/second` per IP max (for all other endpoints, including seat listings, SSE streams, holds, and releases).
### Common Security Controls
* Authentication: Enforced via an `httpOnly`, `sameSite=lax` cookie named `token` containing a signed HS256 JWT.
* Session Refresh: Enforced via an `httpOnly`, `sameSite=strict` cookie named `refresh_token` mapped under path `/api/auth` containing an opaque token UUID.

## 2. Authentication Service (`auth-service` / Port `3001`)
Exposes user onboarding, session lifecycle verification, token rotation, and invalidation.
### `POST /api/auth/register`
Creates a new user record and issues authentication cookies.

* Rate Limit Category: `auth_zone`
* Request Body (JSON):
  ```json
  {
    "email": "user@example.com",
    "password": "Password123!",
    "name": "Jane Doe"
  }
  ```
* Responses:
  * `200 OK`: Registration successful. Sets `token` and `refresh_token` cookies.
    ```json
    {
      "success": true,
      "data": {
        "user": {
          "id": 1,
          "email": "user@example.com"
        }
      }
    }
    ```
  * `409 Conflict`: Email already registered.
    ```json
    {
      "success": false,
      "error": {
        "message": "Email already registered",
        "code": "EMAIL_EXISTS"
      }
    }
    ```
  * `429 Too Many Requests`: Rate limit exceeded.

### `POST /api/auth/login`
Authenticates user using email and password, returning session cookies.

* Rate Limit Category: `auth_zone`
* Request Body (JSON):
  ```json
  {
    "email": "user@example.com",
    "password": "Password123!"
  }
  ```
* Responses:
  * `200 OK`: Login successful. Sets `token` and `refresh_token` cookies.
    ```json
    {
      "success": true,
      "data": {
        "user": {
          "id": 1,
          "email": "user@example.com",
          "name": "Jane Doe"
        }
      }
    }
    ```
  * `401 Unauthorized`: Invalid credentials (enforces timing-equalization delay).
    ```json
    {
      "success": false,
      "error": {
        "message": "Invalid email or password",
        "code": "UNAUTHORIZED"
      }
    }
    ```

### `POST /api/auth/mock-login` (Development Only)
Generates or retrieves a mock user context to facilitate concurrency testing. Disabled in `production` environments (returns `404 Not Found`).

* Request Body (JSON):
  ```json
  {
    "email": "alice@example.com",
    "name": "Alice"
  }
  ```
* Responses:
  * `200 OK`: Sets non-secure cookies for simple local development.
    ```json
    {
      "success": true,
      "data": {
        "user": {
          "id": 2,
          "email": "alice@example.com",
          "name": "Alice",
          "token_version": 0
        }
      }
    }
    ```

### `POST /api/auth/refresh`
Rotates the user's opaque refresh token, invalidates the old token in the database, and issues a fresh Access Token JWT.

* Request Headers:
  * `Cookie: refresh_token=<uuid>` (Required, HttpOnly, Path `/api/auth`)
* Responses:
  * `200 OK`: Returns new token rotation cookies.
    ```json
    {
      "success": true,
      "data": {
        "authenticated": true
      }
    }
    ```
  * `401 Unauthorized`: Refresh token missing, expired, or invalid. If a refresh token is reused, all refresh tokens in the token family are revoked (theft detection).
    ```json
    {
      "success": false,
      "error": {
        "message": "Token refresh failed",
        "code": "UNAUTHORIZED"
      }
    }
    ```

### `POST /api/auth/logout`
Terminates the active session, increments the user's `token_version` (invalidating all active JWTs via Redis cache checks), and clears authentication cookies.

* Request Headers:
  * `Cookie: token=<jwt>` (Required, HttpOnly)
* Responses:
  * `200 OK`: Cookies cleared successfully.
    ```json
    {
      "success": true,
      "data": {
        "success": true
      }
    }
    ```

### `POST /api/auth/logout-all`
Terminates all active sessions for the authenticated user by incrementing `token_version` and deleting all refresh tokens in the database.

* Request Headers:
  * `Cookie: token=<jwt>` (Required, HttpOnly)
* Responses:
  * `200 OK`: All sessions invalidated.
    ```json
    {
      "success": true,
      "data": {
        "success": true
      }
    }
    ```

### `GET /api/auth/me`
Retrieves identity profile information for the current session.

* Request Headers:
  * `Cookie: token=<jwt>` (Optional, HttpOnly)
* Responses:
  * `200 OK` (Authenticated):
    ```json
    {
      "success": true,
      "data": {
        "authenticated": true,
        "user": {
          "id": 1,
          "email": "user@example.com",
          "name": "Jane Doe",
          "picture": null
        }
      }
    }
    ```
  * `200 OK` (Unauthenticated):
    ```json
    {
      "success": true,
      "data": {
        "authenticated": false
      }
    }
    ```

## 3. Seat Service (`seat-service` / Port `3002`)
Handles seat grids, holds (locks), releases (unlocks), and real-time Server-Sent Events (SSE).
### `GET /api/seats`
Lists all venue seats with their statuses and pricing snapshots.

* Rate Limit Category: `general_zone`
* Responses:
  * `200 OK`:
    ```json
    {
      "success": true,
      "data": {
        "seats": [
          {
            "id": 1,
            "number": "A1",
            "status": "available",
            "held_by": null,
            "held_at": null,
            "held_until": null,
            "reserved_by": null,
            "reserved_at": null,
            "price_in_cents": 5000
          },
          {
            "id": 2,
            "number": "A2",
            "status": "locked",
            "held_by": 1,
            "held_at": "2026-06-16T04:00:00.000Z",
            "held_until": "2026-06-16T04:05:00.000Z",
            "reserved_by": null,
            "reserved_at": null,
            "price_in_cents": 7500
          }
        ]
      }
    }
    ```

### `POST /api/seats/:id/hold`
Acquires a pessimistic write lock (`SELECT ... FOR UPDATE`) on the specified seat, transitioning it from `available` to `locked` for a 5-minute window. Enforces a database-level limit of 1 held seat per user.

* Rate Limit Category: `general_zone`
* Path Parameters:
  * `id` (integer, Required) - The unique ID of the seat.
* Request Headers:
  * `Cookie: token=<jwt>` (Required, HttpOnly)
* Responses:
  * `200 OK`: Hold successfully acquired.
    ```json
    {
      "success": true,
      "data": {
        "message": "Seat held",
        "heldUntil": "2026-06-16T04:05:00.000Z"
      }
    }
    ```
  * `409 Conflict`: Seat is already locked/reserved by another user, or caller already holds a seat.
    ```json
    {
      "success": false,
      "error": {
        "message": "Seat is already locked or reserved by another user",
        "code": "SEAT_UNAVAILABLE"
      }
    }
    ```
  * `401 Unauthorized`: Session token invalid or expired.

### `POST /api/seats/:id/lock`
Alias for `POST /api/seats/:id/hold` (returns `307 Temporary Redirect` to ensure backwards compatibility with older clients).

### `POST /api/seats/:id/release`
Releases a held seat, making it `available` again. Only the user who owns the hold may release it.

* Rate Limit Category: `general_zone`
* Path Parameters:
  * `id` (integer, Required) - The unique ID of the seat.
* Request Headers:
  * `Cookie: token=<jwt>` (Required, HttpOnly)
* Responses:
  * `200 OK`: Seat released.
    ```json
    {
      "success": true,
      "data": {
        "message": "Seat released",
        "seatId": 1
      }
    }
    ```
  * `400 Bad Request`: Caller does not own the hold or seat is not currently held.
    ```json
    {
      "success": false,
      "error": {
        "message": "You do not own the hold on this seat",
        "code": "BAD_REQUEST"
      }
    }
    ```

### `POST /api/seats/:id/unlock`
Alias for `POST /api/seats/:id/release` (returns `307 Temporary Redirect`).

### `GET /api/seats/stream`
Establishes a persistent Server-Sent Events (SSE) connection that streams real-time seat status changes.

* Rate Limit Category: `general_zone`
* Request Headers:
  * `Accept: text/event-stream`
* Responses:
  * `200 OK`: Connection opened. Sends message payloads formatted as:
    ```text
    data: {"type":"seat.held","seatId":1,"status":"locked","heldBy":1,"heldUntil":"2026-06-16T04:05:00.000Z"}
    
    data: {"type":"seat.released","seatId":1,"status":"available"}
    ```

## 4. Payment Service (`payment-service` / Port `3003`)
Processes checkouts and handles Stripe webhooks.
### `POST /api/seats/:id/reserve`
Initiates payment for a currently held seat. Resolves seat price on the server-side to prevent client parameter tampering. Invokes the Stripe Payment Intent SDK client.

* Rate Limit Category: `payment_zone`
* Path Parameters:
  * `id` (integer, Required) - The unique ID of the seat to book.
* Request Body (JSON, Optional):
  ```json
  {
    "simulatedStatus": "success"
  }
  ```
  (Options: `"success"` or `"fail"` to dictate simulated asynchronous Stripe outcomes).
* Request Headers:
  * `Cookie: token=<jwt>` (Required, HttpOnly)
* Responses:
  * `200 OK`: Payment successfully initiated. Webhook delivery scheduled asynchronously.
    ```json
    {
      "success": true,
      "data": {
        "message": "Payment initiated",
        "paymentIntentId": "pi_mock_12345"
      }
    }
    ```
  * `404 Not Found`: Seat details not found in payment cache database.
  * `401 Unauthorized`: Invalid session.

### `POST /api/payments/webhook`
Receives webhook callbacks from Stripe. Performs cryptographic HMAC-SHA256 signature verification over the raw string body, validates timestamps (tolerates < 5 minutes clock skew), and inserts into `webhook_inbox` enforcing unique constraint on `stripe_event_id`.

* Rate Limit Category: `general_zone` (high burst threshold)
* Request Headers:
  * `Stripe-Signature: t=<timestamp>,v1=<signature-hash>` (Required)
* Request Body (JSON Text):
  ```json
  {
    "id": "evt_mock_54321",
    "type": "payment_intent.succeeded",
    "data": {
      "object": {
        "id": "pi_mock_12345",
        "metadata": {
          "seatId": "1",
          "userId": "1",
          "dbIntentId": "10"
        }
      }
    }
  }
  ```
* Responses:
  * `200 OK` (Standard): Event successfully saved to the inbox (ack-fast).
    ```json
    {
      "received": true
    }
    ```
  * `200 OK` (Duplicate): Event already exists in `webhook_inbox`. Acknowledged as success to avoid Stripe retries.
    ```json
    {
      "received": true,
      "duplicate": true
    }
    ```
  * `401 Unauthorized`: Signature calculation invalid.
  * `400 Bad Request`: Signature header missing, timestamp expired, or invalid payload.
