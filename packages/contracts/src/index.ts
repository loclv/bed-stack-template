/**
 * @bed-stack/contracts
 *
 * Shared type definitions and event contracts for the seat-reservation system.
 */

export {
	createEvent,
	type EventEnvelope,
	type PaymentCompletedPayload,
	type PaymentFailedPayload,
	type SeatHeldPayload,
	type SeatReleasedPayload,
	type SeatReservedPayload,
	TOPICS,
	type TopicName,
} from "./events";
