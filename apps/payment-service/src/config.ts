/**
 * Payment service configuration.
 * Extends base configuration with payment-specific environment variables.
 */

import {
	type BaseServiceConfig,
	getEnv,
	getEnvNumber,
	getRequiredEnv,
	loadBaseConfig,
} from "@bed-stack/be-core/config";

export interface PaymentServiceConfig extends BaseServiceConfig {
	paymentPort: number;
	stripeSecretKey: string;
	stripeWebhookSecret: string;
	webUrl: string;
	webhookToleranceSeconds: number;
}

/**
 * Load payment service configuration from environment variables.
 */
export function loadPaymentConfig(): PaymentServiceConfig {
	const base = loadBaseConfig("payment");
	const isProd = base.nodeEnv === "production";

	// In production, Stripe keys must be set. In development, we can fallback to mock keys.
	const stripeSecretKey = isProd
		? getRequiredEnv("STRIPE_SECRET_KEY")
		: getEnv("STRIPE_SECRET_KEY", "sk_test_mock_key");

	const stripeWebhookSecret = isProd
		? getRequiredEnv("STRIPE_WEBHOOK_SECRET")
		: getEnv("STRIPE_WEBHOOK_SECRET", "whsec_mock_secret");

	return {
		...base,
		paymentPort: getEnvNumber("PAYMENT_PORT", 3003),
		stripeSecretKey,
		stripeWebhookSecret,
		webUrl: getEnv("WEB_URL", "http://localhost:4097"),
		webhookToleranceSeconds: getEnvNumber("WEBHOOK_TOLERANCE_SECONDS", 300), // 5 minutes
	};
}
