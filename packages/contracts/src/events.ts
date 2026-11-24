/**
 * Typed Kafka event contracts for inter-service communication.
 * All events are versioned for backward compatibility.
 *
 * Convention: topic name = `${domain}.${action}` (e.g., "payment.completed")
 */

/** Base event envelope with metadata. */
export interface EventEnvelope<T = unknown> {
	eventId: string;
	eventType: string;
	version: number;
	timestamp: string;
	source: string;
	payload: T;
}

// ─── Kafka Topic Names ───────────────────────────────────────────────
export const TOPICS = {
	SEAT_HELD: "seat.held",
	SEAT_RELEASED: "seat.released",
	SEAT_RESERVED: "seat.reserved",
	PAYMENT_COMPLETED: "payment.completed",
	PAYMENT_FAILED: "payment.failed",
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

// ─── Seat Events ─────────────────────────────────────────────────────

export interface SeatHeldPayload {
	seatId: number;
	seatNumber: string;
	userId: number;
	heldUntil: string; // ISO timestamp
	priceInCents: number;
}

export interface SeatReleasedPayload {
	seatId: number;
	seatNumber: string;
	userId: number;
	reason: "user_cancelled" | "expired" | "payment_failed";
}

export interface SeatReservedPayload {
	seatId: number;
	seatNumber: string;
	userId: number;
	reservationId: number;
	paymentIntentId: string;
}

// ─── Payment Events ──────────────────────────────────────────────────

export interface PaymentCompletedPayload {
	paymentIntentId: string;
	seatId: number;
	userId: number;
	amountInCents: number;
}

export interface PaymentFailedPayload {
	paymentIntentId: string;
	seatId: number;
	userId: number;
	reason: string;
}

// ─── Type-safe Event Factories ───────────────────────────────────────

/**
 * Create a typed event envelope.
 */
export function createEvent<T>(
	eventType: string,
	source: string,
	payload: T,
	version = 1,
): EventEnvelope<T> {
	return {
		eventId: crypto.randomUUID(),
		eventType,
		version,
		timestamp: new Date().toISOString(),
		source,
		payload,
	};
}
