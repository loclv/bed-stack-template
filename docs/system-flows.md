# Distributed Seat Reservation System — UML Flows & Architectures
## 1. Authentication Flow (OAuth + JWT + Redis Cache)
The client requests authenticate at the Nginx Gateway, which proxies to `auth-service`. Access Token validation uses a Redis-backed version lookup to allow immediate logout invalidation.

```mermaid
sequenceDiagram
    participant User as User
    participant FE as Frontend
    participant GW as Nginx Gateway
    participant Auth as Auth Service
    participant Redis as Redis Cache
    participant DB as Postgres (auth_db)

    User->FE: Click Google Login / Mock Login
    FE->GW: POST /api/auth/mock-login
    GW->Auth: POST /auth/mock-login
    Auth->DB: findOrCreateUser
    DB-->>Auth: User record (token_version = V)
    Auth->Auth: Sign JWT (1h, version V), issue opaque refresh (90d)
    Auth->DB: INSERT refresh_token hash
    Auth->Redis: SET tokenVersion:userId = V
    Auth-->>GW: Set httpOnly cookies: token + refresh_token
    GW-->>FE: Set cookies + 200 OK
    FE->User: Authenticated dashboard
```

## 2. Token Refresh Rotation & Theft Detection
On token refresh, the old token is rotated. If reuse is detected, the family is invalidated. A 10-second grace window prevents mobile retry storms from breaking sessions.

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant GW as Gateway
    participant Auth as Auth Service
    participant DB as Postgres (auth_db)

    FE->GW: POST /api/auth/refresh (with expired token cookie)
    GW->Auth: POST /auth/refresh
    Auth->DB: SELECT refresh_tokens WHERE token_hash = ?
    alt Reuse Detected (token is already revoked)
        Auth->DB: Revoke all tokens with family_id (Theft Invalidation)
        Auth-->>FE: 401 Unauthorized (Clear Cookies)
    else Token Valid
        Auth->DB: Revoke old token & INSERT new refresh token
        Auth->Auth: Sign new JWT (version V)
        Auth-->>FE: Set-Cookie: new token + new refresh_token
    end
```

## 3. Seat Hold Concurrency Flow (Pessimistic Locking)
Pessimistic row locking ensures only one user holds a seat. Unique constraints enforce the "one hold per user" rule.

```mermaid
sequenceDiagram
    participant User as User A
    participant GW as Gateway
    participant Seat as Seat Service
    participant DB as Postgres (seat_db)
    participant Redis as Redis Pub/Sub

    User->GW: POST /api/seats/1/hold (JWT cookie)
    GW->Seat: POST /seats/1/hold
    Note over Seat: Authenticate & check auth-service session
    Seat->DB: BEGIN TRANSACTION
    Seat->DB: SELECT * FROM seats WHERE id = 1 FOR UPDATE
    Note over Seat: If already reserved or held, ROLLBACK & 409
    Seat->DB: UPDATE seats SET status = 'held', held_by = userId WHERE id = 1
    Note over Seat: DB Unique constraint enforces 1 hold per user
    Seat->DB: INSERT outbox (seat.held payload)
    Seat->DB: COMMIT
    Seat->Redis: PUBLISH seat-updates (seat 1 held)
    Seat-->>User: 200 OK (Seat Held)
```

## 4. Webhook Inbox & Transactional Outbox (Reserve Flow)
Ensures reliable transactional operations. Creating checkout creates a payment intent, which triggers simulated webhook delivery.

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant GW as Gateway
    participant Pay as Payment Service
    participant Stripe as Stripe (Mock)
    participant DB as Postgres (payment_db)
    
    FE->GW: POST /api/seats/1/reserve
    GW->Pay: POST /seats/1/reserve
    Pay->DB: SELECT price FROM seats WHERE id = 1 (Server controlled)
    Pay->DB: INSERT payment_intents (status = pending)
    Pay->Stripe: Create Charge
    Stripe-->>Pay: Client secret
    Pay->DB: COMMIT
    Pay-->>FE: 200 OK (Initiated)
    
    Note over Stripe: Async Event Delivery
    Stripe->GW: POST /api/payments/webhook (Stripe-Signature HMAC)
    GW->Pay: POST /payments/webhook
    Note over Pay: Verify HMAC-SHA256 & Freshness (< 5 mins)
    Pay->DB: INSERT webhook_inbox (idempotency check)
    Pay-->>GW: 200 OK (Ack Fast)
```

## 5. Saga Compensation Flow (Payment Failed / Succeeded)
The Payment worker processes the inbox asynchronously and publishes events to Kafka. The Seat service consumes events to reserve the seat or compensate by releasing holds.

```mermaid
sequenceDiagram
    participant Worker as WebhookInboxWorker
    participant DB as Postgres (payment_db)
    participant Outbox as OutboxWorker
    participant Kafka as Kafka Broker
    participant Seat as Seat Service
    participant SeatDB as Postgres (seat_db)

    Worker->DB: Poll PENDING webhook_inbox (SKIP LOCKED)
    Worker->DB: BEGIN
    Worker->DB: UPDATE payment_intents status = 'failed' / 'completed'
    Worker->DB: INSERT outbox (payment.completed / payment.failed event)
    Worker->DB: UPDATE webhook_inbox status = 'DONE'
    Worker->DB: COMMIT
    
    Outbox->DB: Poll PENDING outbox (SKIP LOCKED)
    Outbox->Kafka: Publish payment.failed / payment.completed event
    Outbox->DB: UPDATE outbox status = 'DONE'
    
    Kafka->Seat: Consume payment.failed / payment.completed
    Seat->SeatDB: BEGIN
    Seat->SeatDB: INSERT processed_events (dedup check)
    alt Payment Completed
        Seat->SeatDB: UPDATE seats status = 'reserved', INSERT reservations
    else Payment Failed
        Seat->SeatDB: UPDATE seats status = 'available', clear held_by
    end
    Seat->SeatDB: COMMIT
```

## 6. Gateway Request Pipeline
Nginx filters and routes all inbound traffic.

```mermaid
graph TB
    subgraph Client Layer
        FE[React SPA]
    end

    subgraph Gateway Layer (Nginx :3000)
        GW[Nginx Gateway]
        Rate[Rate Limiting Zone: auth/payment/general]
        Route{Match Path}
    end

    subgraph Service Mesh
        Auth[Auth Service :3001]
        Seats[Seat Service :3002]
        Pay[Payment Service :3003]
    end

    subgraph Datastores
        DB1[(auth_db)]
        DB2[(seat_db)]
        DB3[(payment_db)]
        Redis[(Redis Cache)]
        Kafka[(Kafka Broker)]
    end

    FE -->|HTTP request| GW
    GW --> Rate
    Rate --> Route
    Route -->|/api/auth/*| Auth
    Route -->|/api/seats/*| Seats
    Route -->|/api/seats/:id/reserve| Pay
    
    Auth --> DB1
    Auth --> Redis
    
    Seats --> DB2
    Seats --> Redis
    
    Pay --> DB3
    Pay --> Redis
    Pay --> Kafka
    Kafka -.->|Event Saga| Seats
```
