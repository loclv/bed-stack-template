/**
 * Standardized API response builder.
 * Ensures consistent response format across all services.
 */

export interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: {
		message: string;
		code?: string;
	};
	meta: {
		timestamp: string;
		requestId?: string;
	};
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
	meta: ApiResponse["meta"] & {
		page?: number;
		limit?: number;
		total?: number;
		totalPages?: number;
	};
}

/**
 * Build standardized API responses for consistent client communication.
 */
export class ResponseBuilder {
	/**
	 * Create a base response object.
	 */
	static createBaseResponse<T>(
		success: boolean,
		data?: T,
		error?: string,
		code?: string,
	): ApiResponse<T> {
		return {
			success,
			data,
			error: error ? { message: error, code } : undefined,
			meta: { timestamp: new Date().toISOString() },
		};
	}

	/** Return a success response. */
	static success<T>(
		data: T,
		meta?: Partial<ApiResponse<T>["meta"]>,
	): ApiResponse<T> {
		const response = ResponseBuilder.createBaseResponse(true, data);
		if (meta) {
			response.meta = { ...response.meta, ...meta } as ApiResponse<T>["meta"];
		}
		return response;
	}

	/** Return an error response. */
	static error(
		message: string,
		code?: string,
		_details?: unknown,
	): ApiResponse {
		return ResponseBuilder.createBaseResponse(false, undefined, message, code);
	}

	/** Return a paginated success response. */
	static paginated<T>(
		data: T[],
		page: number,
		limit: number,
		total: number,
	): PaginatedResponse<T> {
		return {
			success: true,
			data,
			meta: {
				timestamp: new Date().toISOString(),
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
		};
	}

	/** 401 Unauthorized response. */
	static unauthorized(message = "Unauthorized"): ApiResponse {
		return ResponseBuilder.error(message, "UNAUTHORIZED");
	}

	/** 403 Forbidden response. */
	static forbidden(message = "Forbidden"): ApiResponse {
		return ResponseBuilder.error(message, "FORBIDDEN");
	}

	/** 404 Not Found response. */
	static notFound(message = "Resource not found"): ApiResponse {
		return ResponseBuilder.error(message, "NOT_FOUND");
	}

	/** 422 Validation Error response. */
	static validation(message = "Validation failed"): ApiResponse {
		return ResponseBuilder.error(message, "VALIDATION_ERROR");
	}

	/** 409 Conflict response with optional Retry-After hint. */
	static conflict(message: string, retryAfterSeconds?: number): ApiResponse {
		return ResponseBuilder.error(message, "CONFLICT", { retryAfterSeconds });
	}

	/** 500 Internal Error response. */
	static internal(message = "Internal server error"): ApiResponse {
		return ResponseBuilder.error(message, "INTERNAL_ERROR");
	}
}
