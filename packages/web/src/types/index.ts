export interface User {
	id: number;
	email: string;
	name: string | null;
	picture: string | null;
}

export type SeatStatus = "available" | "locked" | "reserved";

export interface Seat {
	id: number;
	number: string;
	status: SeatStatus;
	lockedBy: number | null;
	lockedAt: string | null;
	reservedBy: number | null;
	reservedAt: string | null;
	priceInCents: number;
}

export interface Reservation {
	id: number;
	seatId: number;
	userId: number;
	paymentIntentId: string;
	amountInCents: number;
	createdAt: string;
}
