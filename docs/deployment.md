# Distributed Seat Reservation System — Deployment Guide
This document covers the configuration, orchestration, and production considerations for deploying the distributed seat reservation microservices system.

## 1. System Requirements
- Bun >=1.3.14 (runtime for all microservices)
- Docker & Docker Compose (for orchestrating Postgres, Redis, Kafka, and Nginx)
- PostgreSQL 15+ (database engine)
- Redis 7+ (rate limiting store & SSE pub/sub)
- Apache Kafka 3.4+ (event streaming broker)

## 2. Configuration & Environment Variables
All services load configuration from a `.env` file at startup. Refer to [.env.example](./seat-reservation/.env.example) for defaults.
### Required Global Variables
- `JWT_SECRET`: Secret key for signing Access Token JWTs (HS256).
- `JWT_REFRESH_SECRET`: Secret key for signing and hashing Refresh Tokens.
### Service-Specific Port Allocation
- `auth-service`: Port `3001`
- `seat-service`: Port `3002`
- `payment-service`: Port `3003`
- `gateway` (Nginx): Port `3000`
- `web` (Frontend): Port `4097`

## 3. Production Deployment Architecture
```text
                                      DNS (SeatFlow.com)
                                              |
                                     [ Nginx API Gateway ]
                                         (Port: 3000)
                                              |
                  ┌───────────────────────────┼───────────────────────────┐
                  |                           |                           |
                  v                           v                           v
          [ Auth Service ]            [ Seat Service ]            [ Payment Service ]
            (Port: 3001)                (Port: 3002)                (Port: 3003)
                  |                           |                           |
            (argon2 CPU)                  (DB locks)                  (I/O Webhooks)
                  |                           |                           |
                  v                           v                           v
         ┌───────────────────┐        ┌───────────────────┐       ┌───────────────────┐
         │ PostgreSQL Engine │        │ Redis Cluster     │       │ Kafka Brokers     │
         │  - auth_db        │        │  - Token version  │       │  - seat.held      │
         │  - seat_db        │        │  - Rate limiting  │       │  - seat.released  │
         │  - payment_db     │        │  - SSE Pub/Sub    │       │  - payment.*      │
         └───────────────────┘        └───────────────────┘       └───────────────────┘
```

## 4. Production Considerations
### PostgreSQL Connection Tuning
- Max Connections: Set Postgres connection bounds on services using:
  - Auth/Payment services: `maxConnections: 10`
  - Seat service (DB-bound locking workload): `maxConnections: 20`
- PgBouncer: For large horizontal scaling deployments, it is highly recommended to place PgBouncer in front of the PostgreSQL instance to multiplex connections and prevent connection exhaustion.
- Troubleshooting: Always enable `log_lock_waits=on` and `deadlock_timeout=1s` to track row contention on seat holds.
### Redis Operations
- L1/L2 Rate Limit Caching: Redis-backed limits prevent state loss on service replica restarts. Monitor for fail-open scenarios in your application logs if Redis goes offline.
- tokenVersion Cache: JWT verifications read `token_version` from Redis instead of hitting `auth_db` users table on every single request. Ensure Redis eviction policies are set to `volatile-lru` or `noeviction` for authorization key persistence.
### Kafka Clustering & Partitioning
- Order Guarantees: Kafka topics (like `payment.completed` and `payment.failed`) must be partitioned by `seatId` to ensure all state changes for a single seat are processed sequentially.
- Consumer Groups: Use consumer group name `seat-service` to allow horizontal replication of seat workers. Each partition will be pinned to a single consumer instance, preventing concurrent processing issues.
- Dead Letter Queues (DLQ): In production, configure consumer retry limits (e.g., max 5 attempts) and redirect unprocessable events to a dedicated `payment.failed.dlq` topic for manual troubleshooting.

## 5. Deployment Steps via Docker Compose
To build and spin up the entire distributed cluster locally:

1. Configure Environment Variables:
   You can automatically copy the template `.env.example` configurations to `.env` for the root and all microservices using:
   ```bash
   bun env:setup
   ```
   Or copy them manually:
   ```bash
   cp .env.example .env
   cp apps/auth-service/.env.example apps/auth-service/.env
   cp apps/seat-service/.env.example apps/seat-service/.env
   cp apps/payment-service/.env.example apps/payment-service/.env
   cp packages/web/.env.example packages/web/.env
   ```
2. Build and Run Containers:
   ```bash
   docker-compose up --build -d
   ```
3. Execute Versioned Database Migrations:
   Run the migration tool to initialize schemas (`auth_db`, `seat_db`, `payment_db`):
   ```bash
   ./scripts/run-migrations.sh
   ```
4. Monitor Status & Uptime:
   Use Docker health status checking or hit readiness probes:
   ```bash
   docker ps
   curl http://localhost:3000/health
   curl http://localhost:3001/health/ready
   ```
