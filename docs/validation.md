# Distributed Seat Reservation System — Input & Boundary Validation
This document describes the schema validation strategy, data transfer objects (DTOs), and compile-time type-safety mechanisms implemented at the microservice boundaries.

## 1. Schema Validation Strategy
To prevent security vulnerabilities (such as prototype pollution, SQL injection parameters, and parameter tampering), all microservices enforce strict schema validation at the HTTP boundaries using TypeBox (via Elysia's native `t` schema builder).
### Core Principles
1. No Implicit `any`: All incoming request payloads (JSON bodies, path parameters, query parameters) are strictly typed.
2. Strip Unknown Fields: Elysia automatically strips headers, queries, and body fields that are not explicitly defined in the schema.
3. Coercion: Path parameters and query params (which always arrive as strings) are automatically coerced to numbers, booleans, or objects.

## 2. Validation Boundaries & Schemas
### 1. Auth Service (`auth-service`)
Auth boundaries validate registration, email/password logins, and mock-login inputs.
#### Route: `POST /auth/register`
```typescript
{
	body: t.Object({
		email: t.String({ format: "email", error: "Must be a valid email address" }),
		password: t.String({ minLength: 8, maxLength: 128, error: "Password must be between 8 and 128 characters" }),
		name: t.Optional(t.String({ minLength: 1, maxLength: 100 }))
	})
}
```
#### Route: `POST /auth/login`
```typescript
{
	body: t.Object({
		email: t.String({ format: "email" }),
		password: t.String({ minLength: 1 })
	})
}
```
#### Route: `POST /auth/mock-login` (Development Only)
```typescript
{
	body: t.Object({
		email: t.String(),
		name: t.Optional(t.String())
	})
}
```

### 2. Seat Service (`seat-service`)
Seat service routes handle listing, holds, releases, and real-time streams.
#### Route: `POST /seats/:id/hold` (and `/lock` / `/unlock` / `/release` aliases)
- Path Parameter: Evaluates and coerces `:id` parameter to a positive integer.
```typescript
{
	params: t.Object({
		id: t.String({ error: "Seat ID must be a numeric string" })
	})
}
```

### 3. Payment Service (`payment-service`)
Payment service routes validate checkout bookings and incoming webhook callbacks.
#### Route: `POST /seats/:id/reserve`
- Path Parameter: `:id` as numeric string.
- Body Parameter: Optional `simulatedStatus` (either `success` or `fail`).
```typescript
{
	params: t.Object({
		id: t.String()
	}),
	body: t.Object({
		simulatedStatus: t.Optional(t.Union([
			t.Literal("success"),
			t.Literal("fail")
		]))
	})
}
```
#### Route: `POST /payments/webhook`
- Headers: Enforces the presence of the signature metadata.
- Request Body: Captured as raw text to execute the timing-safe cryptographic signature verify.

## 3. Shared Event Contracts (`packages/contracts`)
Inter-service event payloads sent over Kafka are structured and versioned to prevent downstream processing errors:

```typescript
export interface SeatHeldPayload {
	seatId: number;
	seatNumber: string;
	userId: number;
	heldUntil: string; // ISO datetime
	priceInCents: number;
}

export interface PaymentCompletedPayload {
	paymentIntentId: string;
	seatId: number;
	userId: number;
	amountInCents: number;
}
```
All messages are wrapped inside a versioned `EventEnvelope` structure:
```typescript
export interface EventEnvelope<T = unknown> {
	eventId: string;     // UUID v4
	eventType: string;   // dot-separated domain.action
	version: number;     // schema version
	timestamp: string;   // ISO datetime
	source: string;      // producer service name
	payload: T;          // typed event payload
}
```
