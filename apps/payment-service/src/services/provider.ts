/**
 * Payment provider boundary and mock Stripe client.
 * Provides abstract interface for easy swapping with a real Stripe SDK.
 */

import crypto from "node:crypto";
import { createLogger } from "@bed-stack/be-core";

const logger = createLogger("payment-provider");

export interface PaymentIntentDetails {
	id: string;
	amount: number;
	clientSecret: string;
	status: "pending" | "succeeded" | "failed";
}

export interface PaymentProvider {
	/** Create a payment intent */
	createPaymentIntent(
		amountInCents: number,
		metadata: Record<string, string>,
	): Promise<PaymentIntentDetails>;

	/** Verify incoming webhook signature */
	verifyWebhookSignature(
		rawBody: string,
		signatureHeader: string,
		webhookSecret: string,
		toleranceSeconds: number,
	): boolean;
}

/**
 * Mock Stripe payment provider implementation.
 * Simulates Stripe behaviors, including webhook signing.
 */
export class MockStripeProvider implements PaymentProvider {
	constructor(private webhookUrl: string) {}

	/**
	 * Create a mock payment intent.
	 */
	async createPaymentIntent(
		amountInCents: number,
		_metadata: Record<string, string>,
	): Promise<PaymentIntentDetails> {
		const id = `pi_mock_${crypto.randomBytes(12).toString("hex")}`;
		logger.info("Mock payment intent created", { id, amountInCents });
		return {
			id,
			amount: amountInCents,
			clientSecret: `${id}_secret_${crypto.randomBytes(6).toString("hex")}`,
			status: "pending",
		};
	}

	/**
	 * Verify Stripe-style HMAC signature.
	 */
	verifyWebhookSignature(
		rawBody: string,
		signatureHeader: string,
		webhookSecret: string,
		toleranceSeconds: number,
	): boolean {
		try {
			const parts = signatureHeader.split(",");
			const tPart = parts.find((p) => p.startsWith("t="));
			const v1Part = parts.find((p) => p.startsWith("v1="));

			if (!tPart || !v1Part) {
				logger.warn("Invalid signature header format");
				return false;
			}

			const timestampStr = tPart.substring(2);
			const signature = v1Part.substring(3);

			const timestamp = Number.parseInt(timestampStr, 10);
			if (Number.isNaN(timestamp)) {
				logger.warn("Invalid signature timestamp");
				return false;
			}

			// Freshness check: reject if difference is larger than tolerance
			const age = Math.abs(Date.now() / 1000 - timestamp);
			if (age > toleranceSeconds) {
				logger.warn("Signature expired", { age, toleranceSeconds });
				return false;
			}

			const signedPayload = `${timestamp}.${rawBody}`;
			const expectedSignature = crypto
				.createHmac("sha256", webhookSecret)
				.update(signedPayload)
				.digest("hex");

			return crypto.timingSafeEqual(
				Buffer.from(signature, "hex"),
				Buffer.from(expectedSignature, "hex"),
			);
		} catch (err) {
			logger.error("Failed to verify signature", { error: err as Error });
			return false;
		}
	}

	/**
	 * Simulate webhook callback delivery from Stripe.
	 * Sends a POST request to our webhook url with a valid signature.
	 */
	async simulateWebhookDelivery(
		eventId: string,
		type: "payment_intent.succeeded" | "payment_intent.payment_failed",
		paymentIntentId: string,
		seatId: number,
		userId: number,
		amountInCents: number,
		webhookSecret: string,
	): Promise<void> {
		const payload = {
			id: eventId,
			type,
			data: {
				object: {
					id: paymentIntentId,
					amount: amountInCents,
					metadata: {
						seatId: String(seatId),
						userId: String(userId),
					},
				},
			},
		};

		const rawBody = JSON.stringify(payload);
		const timestamp = Math.floor(Date.now() / 1000);
		const signedPayload = `${timestamp}.${rawBody}`;
		const signature = crypto
			.createHmac("sha256", webhookSecret)
			.update(signedPayload)
			.digest("hex");

		const signatureHeader = `t=${timestamp},v1=${signature}`;

		// Deliver asynchronously to mimic Stripe network delay
		setTimeout(async () => {
			try {
				logger.info("Simulating webhook delivery", { type, paymentIntentId });
				const res = await fetch(this.webhookUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Stripe-Signature": signatureHeader,
					},
					body: rawBody,
				});

				if (!res.ok) {
					logger.error("Simulated webhook delivery failed", {
						status: res.status,
						text: await res.text(),
					});
				} else {
					logger.info("Simulated webhook delivery completed", {
						paymentIntentId,
					});
				}
			} catch (err) {
				logger.error("Failed to deliver simulated webhook", {
					error: err as Error,
				});
			}
		}, 500); // 500ms network delay simulation
	}
}
