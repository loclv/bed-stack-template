---
description: Seat-reservation app logic state machine diagrams and workflows
---
# Seat Reservation — State Machines
This guide provides visual state machines, sequence diagrams, and ER diagrams for the authentication, seat holds, checkout, and saga compensation flows.

## 1. Authentication Lifecycle
### State Machine
```mermaid
stateDiagram-v2
    [*] --> Unauthenticated

    state Unauthenticated {
        [*] --> Idle
        Idle --> GoogleOAuthRedirect: GET /auth/google
        Idle --> MockLoginForm: dev mode
    }

    GoogleOAuthRedirect --> OAuthCallback: browser redirects to Google
    OAuthCallback --> VerifyGoogleToken: GET /auth/callback?code=
    VerifyGoogleToken --> FindOrCreateUser: token valid
    VerifyGoogleToken --> RateLimitError: too many attempts
    FindOrCreateUser --> SetCookies: user found/created

    MockLoginForm --> CreateMockUser: POST /auth/mock-login {email, name}
    CreateMockUser --> SetCookies: DB insert (token_version = 0)

    state SetCookies {
        [*] --> SetJwtCookie: 1 hour, httpOnly, lax, path=/
        SetJwtCookie --> SetRefreshCookie: 90 days, httpOnly, strict, path=/api/auth
        SetRefreshCookie --> SetCsrfCookie: 24h, JS-readable
        SetCsrfCookie --> [*]
    }

    SetCookies --> Authenticated: redirect to web
    
    state Authenticated {
        [*] --> HasValidSession
        HasValidSession --> TokenExpired: Access Token > 1h
        TokenExpired --> RefreshTokenRotation: POST /api/auth/refresh
        
        state RefreshTokenRotation {
            [*] --> ValidateHashedRefresh: verify SHA-256 hash in auth_db
            ValidateHashedRefresh --> CheckTheft: token already used?
            CheckTheft --> RevokeFamily: Yes (reuse detected)
            RevokeFamily --> ClearSession: revoke all family IDs
            CheckTheft --> GraceWindow: No (first refresh request)
            GraceWindow --> IssueNewTokens: within 10s grace skew
            GraceWindow --> RotateTokenChain: after 10s grace
            RotateTokenChain --> IssueNewTokens: delete old token, generate new
        }

        IssueNewTokens --> HasValidSession: cookies updated
        ClearSession --> Unauthenticated: forced logout
    }

    Authenticated --> Logout: POST /api/auth/logout
    Logout --> BumpTokenVersion: UPDATE users set token_version = version + 1
    BumpTokenVersion --> InvalidateCache: clear Redis version cache
    InvalidateCache --> RevokeAllRefresh: delete refresh tokens where userId
    RevokeAllRefresh --> ClearCookies: maxAge=0
    ClearCookies --> Unauthenticated
```

## 2. Distributed Seat Lifecycle & Sagas
### State Machine
The seat state is managed in `seat_db`, updated transactionally via local holds and asynchronous Kafka events:

```mermaid
stateDiagram-v2
    [*] --> Available

    Available --> Locked: POST /api/seats/:id/hold (or /lock alias)
    
    state Locked {
        [*] --> VerifyHoldTime: held_until > now
        VerifyHoldTime --> Expired: held_until <= now
        VerifyHoldTime --> Active: held_until > now
    }

    Locked --> Available: POST /api/seats/:id/release (or /unlock alias)
    Locked --> Available: Expiry Sweeper (FOR UPDATE SKIP LOCKED)
    
    Locked --> SagaCheckoutPending: POST /api/seats/:id/reserve
    
    state SagaCheckoutPending {
        [*] --> CreatePendingIntent: INSERT payment_intent (pending)
        CreatePendingIntent --> WebhookReceived: mock signature verified
        WebhookReceived --> InboxAck: insert webhook_inbox (ack-fast)
        InboxAck --> OutboxEvent: process webhook -> write payment.completed / payment.failed
    }

    OutboxEvent --> SagaFulfillment: Kafka outbox worker publishes event
    
    state SagaFulfillment {
        [*] --> ProcessKafkaEvent: consume payment event
        ProcessKafkaEvent --> UpdateSeatReserved: payment.completed (HAPPY PATH)
        ProcessKafkaEvent --> CompensateRelease: payment.failed (ROLLBACK PATH)
    }

    UpdateSeatReserved --> Reserved
    CompensateRelease --> Available
    
    Reserved --> [*]
```

## 3. Frontend UI State Workflow
```mermaid
stateDiagram-v2
    [*] --> Loading

    Loading --> CheckAuth: GET /api/auth/me
    CheckAuth --> FetchSeats: authenticated === true
    CheckAuth --> ShowLoginPrompt: authenticated === false

    ShowLoginPrompt --> MockLoginClick: user clicks switch account
    MockLoginClick --> FetchSeats: POST /api/auth/mock-login

    FetchSeats --> SeatGrid: seats loaded
    SeatGrid --> Polling: refetch every 4 seconds
    SeatGrid --> SSEUpdates: subscribe GET /api/seats/stream

    SeatGrid --> SeatClick: user clicks available seat
    SeatClick --> HoldRequest: POST /api/seats/:id/hold (with CSRF header)
    HoldRequest --> SeatGrid: error (409 conflict)
    HoldRequest --> CheckoutPanel: success, seat holds

    state CheckoutPanel {
        [*] --> ShowTimer: 5-minute countdown
        ShowTimer --> TimerTick: 1s interval
        TimerTick --> ShowTimer: time > 0
        TimerTick --> AutoRelease: time = 0
        AutoRelease --> [*]: seat hold expired
    }

    CheckoutPanel --> CancelClick: user clicks Release Hold
    CancelClick --> ReleaseRequest: POST /api/seats/:id/release
    ReleaseRequest --> SeatGrid

    CheckoutPanel --> ConfirmClick: user clicks Pay
    ConfirmClick --> PaymentProcessing: show loading spinner
    PaymentProcessing --> ReserveRequest: POST /api/seats/:id/reserve
    ReserveRequest --> SuccessMessage: success (200 OK)
    ReserveRequest --> ErrorMessage: error (simulated fail)
    SuccessMessage --> SeatGrid: seat marked reserved
    ErrorMessage --> CheckoutPanel: retry checkout
```

## 4. Concurrency Sequence Diagram (Happy Path)
```mermaid
sequenceDiagram
    participant UserA as User A (Alice)
    participant GW as Nginx Gateway
    participant Seats as Seat Service
    participant Pay as Payment Service
    participant Kafka as Kafka Broker
    participant UserB as User B (Bob)

    UserA->>GW: POST /api/seats/1/hold (with csrf-token)
    GW->>Seats: POST /seats/1/hold
    Note over Seats: Begin Tx (FOR UPDATE)<br/>Insert seat hold<br/>Commit Tx
    Seats-->>GW: 200 OK (held_until)
    GW-->>UserA: Seat #1 Locked

    UserB->>GW: GET /api/seats
    GW->>Seats: GET /seats
    Seats-->>GW: Seat #1 is locked
    GW-->>UserB: Seat #1 shows locked

    UserA->>GW: POST /api/seats/1/reserve (simulatedStatus=success)
    GW->>Pay: POST /seats/1/reserve
    Note over Pay: Create Payment Intent (pending)<br/>Call Stripe Mock Provider
    Pay-->>GW: 200 OK (paymentIntentId)
    GW-->>UserA: Payment initiated

    Note over Pay: Stripe async webhook triggers<br/>POST /payments/webhook
    Pay->>Pay: Ack-fast insert to webhook_inbox (200 OK)
    Note over Pay: Outbox worker publishes payment.completed
    Pay->>Kafka: Publish "payment.completed" event

    Kafka->>Seats: Consume "payment.completed"
    Note over Seats: Transactionally:<br/>Update seat #1 to reserved<br/>Insert reservation record
    Seats->>Seats: Publish "seat.reserved" to Redis Pub/Sub
    Seats-->>UserA: (SSE stream) data: {"type":"seat.reserved","seatId":1}
    Seats-->>UserB: (SSE stream) data: {"type":"seat.reserved","seatId":1}
```

## 5. Partitioned Database Schema
```mermaid
erDiagram
    subgraph auth_db
        users ||--o{ refresh_tokens : owns
        users ||--o{ audit_log : logs
        users {
            int id PK
            string email UK
            string password_hash
            string name
            int token_version
            datetime created_at
        }
        refresh_tokens {
            int id PK
            int user_id FK
            string token_hash UK
            datetime expires_at
            string family_id
        }
        audit_log {
            int id PK
            int user_id FK
            string action
            json details
            string ip_address
        }
    end

    subgraph seat_db
        seats ||--o{ reservations : binds
        seats {
            int id PK
            string number UK
            string status "available|locked|reserved"
            int held_by
            datetime held_until
            int price_in_cents
        }
        reservations {
            int id PK
            int seat_id FK
            int user_id
            string payment_intent_id
            int amount_in_cents
            datetime created_at
        }
    end

    subgraph payment_db
        payment_intents ||--o{ webhook_inbox : processes
        payment_intents {
            int id PK
            string external_id UK
            int user_id
            int seat_id
            int amount_in_cents
            string status "pending|completed|failed"
        }
        webhook_inbox {
            int id PK
            string stripe_event_id UK
            string event_type
            string payload
            string status "PENDING|PROCESSED|FAILED"
        }
    end
```

## 6. Key Constants
| Constant | Value | Purpose |
|---|---|---|
| JWT Access Expiry | 1 hour (`3600s`) | Token lifetime |
| Refresh Token Expiry | 90 days (`7776000s`) | Persistence session lifetime |
| Token Grace Window | 10 seconds | Rotation reconnect tolerance |
| Seat Hold TTL | 5 minutes (`300s`) | Temporary booking hold limit |
| SSE Heartbeat | 30 seconds | SSE stream keep-alive pulse |
| CSRF Expiry | 24 hours | CSRF cookie lifespan |
| Seat Poll Interval | 4 seconds | Fallback seat refetch timing |
| Auth Rate Limit | 10 req/minute per IP | Throttling zone on Gateway |
| Payment Rate Limit | 15 req/minute per IP | Throttling zone on Gateway |
| General Rate Limit | 10 req/second per IP | Throttling zone on Gateway |
| Webhook Clock Skew | 5 minutes (`300s`) | Maximum webhook timestamp drift |

## 7. Error Codes
| Error Code | HTTP Status | Meaning |
|---|---|---|
| `RATE_LIMIT_EXCEEDED` | `429 Too Many Requests` | IP rate limit exceeded |
| `UNAUTHORIZED` | `401 Unauthorized` | Invalid cookie token, CSRF header, or expired session |
| `SEAT_UNAVAILABLE` | `409 Conflict` | Target seat is already held or reserved by another client |
| `EMAIL_EXISTS` | `409 Conflict` | Registration email already exists |
| `BAD_REQUEST` | `400 Bad Request` | Validation parameters, clock mismatch, or user does not own hold |
| `INTERNAL_SERVER_ERROR` | `500 Internal Server Error` | Database or outbox worker failure |
