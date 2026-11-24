/**
 * Kafka producer and consumer abstractions using KafkaJS.
 * Provides typed event publishing and consumption with consumer groups.
 */

import {
	type Consumer,
	type EachMessagePayload,
	Kafka,
	type Producer,
} from "kafkajs";
import { createLogger } from "./logger";

const logger = createLogger("kafka");

export interface KafkaConfig {
	brokers: string[];
	clientId: string;
	groupId?: string;
}

/**
 * Create a Kafka client instance.
 */
export function createKafkaClient(config: KafkaConfig): Kafka {
	return new Kafka({
		clientId: config.clientId,
		brokers: config.brokers,
		retry: {
			initialRetryTime: 300,
			retries: 8,
		},
	});
}

/**
 * Kafka producer wrapper with JSON serialization.
 */
export class KafkaProducer {
	private producer: Producer;
	private connected = false;

	constructor(kafka: Kafka) {
		this.producer = kafka.producer();
	}

	/** Connect the producer. */
	async connect(): Promise<void> {
		await this.producer.connect();
		this.connected = true;
		logger.info("Kafka producer connected");
	}

	/**
	 * Publish a typed event to a Kafka topic.
	 * @param topic - Kafka topic name
	 * @param key - Message key for partitioning
	 * @param event - Event payload (will be JSON serialized)
	 */
	async publish<T>(topic: string, key: string, event: T): Promise<void> {
		if (!this.connected) {
			throw new Error("Kafka producer not connected");
		}

		await this.producer.send({
			topic,
			messages: [
				{
					key,
					value: JSON.stringify(event),
					headers: {
						"event-time": new Date().toISOString(),
					},
				},
			],
		});

		logger.debug("Kafka event published", { topic, key });
	}

	/** Disconnect the producer. */
	async disconnect(): Promise<void> {
		await this.producer.disconnect();
		this.connected = false;
		logger.info("Kafka producer disconnected");
	}
}

export type MessageHandler = (payload: EachMessagePayload) => Promise<void>;

/**
 * Kafka consumer wrapper with automatic deserialization.
 */
export class KafkaConsumer {
	private consumer: Consumer;

	constructor(kafka: Kafka, groupId: string) {
		this.consumer = kafka.consumer({ groupId });
	}

	/** Connect the consumer. */
	async connect(): Promise<void> {
		await this.consumer.connect();
		logger.info("Kafka consumer connected");
	}

	/**
	 * Subscribe to topics and start consuming.
	 * @param topics - Array of topic names
	 * @param handler - Message handler function
	 */
	async subscribe(topics: string[], handler: MessageHandler): Promise<void> {
		for (const topic of topics) {
			await this.consumer.subscribe({ topic, fromBeginning: false });
			logger.info("Subscribed to topic", { topic });
		}

		await this.consumer.run({
			eachMessage: async (payload) => {
				try {
					await handler(payload);
				} catch (err) {
					logger.error("Message handler error", {
						topic: payload.topic,
						partition: payload.partition,
						offset: payload.message.offset,
						error: err as Error,
					});
					// TODO(prod): Dead letter queue for permanently failed messages
				}
			},
		});
	}

	/** Disconnect the consumer. */
	async disconnect(): Promise<void> {
		await this.consumer.disconnect();
		logger.info("Kafka consumer disconnected");
	}
}
