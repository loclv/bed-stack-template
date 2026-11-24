# Distributed Seat Reservation System — Developer Guide
This document describes the setup, execution, testing, and common tasks for developing in the distributed seat reservation microservices system.

## 1. Prerequisites
- Bun (Used for all local script executions and workspace installations).
- Docker Engine & Docker Compose (Used to orchestrate databases, cache, broker, and gateway).

## 2. Workspace Setup
Clone the repository and install workspace dependencies:
```bash
git clone <repo>
cd seat-reservation
bun install
```

Configure your environment variables for all services:
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

## 3. Running the Microservices Local Cluster
Development orchestration runs inside Docker containers:

```bash
# Build and spin up the complete infrastructure in background
docker-compose up --build -d

# Show current status of services
docker ps
```

Once running, the components are mapped to local host ports:
- API Gateway: `http://localhost:3000/api`
- React Web Application: `http://localhost:4097` (Frontend static client)
- Auth Service: `http://localhost:3001`
- Seat Service: `http://localhost:3002`
- Payment Service: `http://localhost:3003`
### Executing Database Migrations
Before running workflows, migrations must be executed to prepare database tables:
```bash
./scripts/run-migrations.sh
```

## 4. Testing
### Run Automated Integration Smoke Test
This script register a user, acquires a seat hold, processes payment (success and fails), and checks the final states:
```bash
./scripts/smoke-test.sh
```
### Run Legacy Integration & Unit Tests
You can verify core package utilities (CSRF, validation schemas, response builders) using:
```bash
# General core utilities tests
bun run --cwd packages/api test

# React Web frontend tests
bun run --cwd packages/web test
```

## 5. Directory Mapping & Technologies
```text
seat-reservation/
├─apps/ # Distributed Microservices (Elysia)
│   ├─auth-service/ # Port 3001
│   ├─seat-service/ # Port 3002
│   └─payment-service/ # Port 3003
├─packages/ # Monorepo Workspace Libraries
│   ├─be-core/ # Shared DB pools, Kafka, outbox utils
│   └─contracts/ # Versioned Kafka schema contracts
├─infra/ # Gateway & Infrastructure scripts
│   ├─nginx/ # nginx.conf rate limiting proxy
│   └─postgres/ # init.sql Postgres DB initializer
├─migrations/ # Per-service PostgreSQL migrations
└─scripts/ # Migration runners and E2E smoke tests
```

## 6. Manual API Verification with curl
Ensure the cluster is running (`docker-compose up`) and migrations are executed.
### 1. Mock Login (Fetch Session Cookies)
```bash
curl -s -i -X POST http://localhost:3000/api/auth/mock-login \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","name":"Developer"}' \
  -c /tmp/cookies.txt
```
This logs you in and saves session cookies in `/tmp/cookies.txt`.
### 2. Lock Seat A1 (ID: 1)
```bash
curl -s -i -b /tmp/cookies.txt -X POST http://localhost:3000/api/seats/1/lock \
  -H "Content-Type: application/json"
```
Transition status to `held`.
### 3. Initiate Checkout Reservation
Simulate payment success:
```bash
curl -s -i -b /tmp/cookies.txt -X POST http://localhost:3000/api/seats/1/reserve \
  -H "Content-Type: application/json" \
  -d '{"simulatedStatus":"success"}'
```
This registers the checkout, triggers Stripe Mock webhook, pushes a `payment.completed` event to Kafka via payment outbox, and transitions the seat to `reserved` asynchronously.
