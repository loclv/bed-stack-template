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

export class ResponseBuilder {
	static createBaseResponse<T>(
		success: boolean,
		data?: T,
		error?: string,
		code?: string,
	): ApiResponse<T> {
		return {
			success,
			data,
			error: error
				? {
						message: error,
						code,
					}
				: undefined,
			meta: {
				timestamp: new Date().toISOString(),
			},
		};
	}

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

	static error(
		message: string,
		code?: string,
		_details?: unknown,
	): ApiResponse {
		return ResponseBuilder.createBaseResponse(false, undefined, message, code);
	}

	static paginated<T>(
		data: T[],
		page: number,
		limit: number,
		total: number,
		meta?: Partial<PaginatedResponse<T>["meta"]>,
	): PaginatedResponse<T> {
		const totalPages = Math.ceil(total / limit);

		return {
			success: true,
			data,
			meta: {
				timestamp: new Date().toISOString(),
				page,
				limit,
				total,
				totalPages,
				...meta,
			},
		};
	}

	static unauthorized(message = "Unauthorized"): ApiResponse {
		return ResponseBuilder.error(message, "UNAUTHORIZED");
	}

	static forbidden(message = "Forbidden"): ApiResponse {
		return ResponseBuilder.error(message, "FORBIDDEN");
	}

	static notFound(message = "Resource not found"): ApiResponse {
		return ResponseBuilder.error(message, "NOT_FOUND");
	}

	static validation(
		message = "Validation failed",
		_details?: unknown,
	): ApiResponse {
		return ResponseBuilder.error(message, "VALIDATION_ERROR");
	}

	static internal(message = "Internal server error"): ApiResponse {
		return ResponseBuilder.error(message, "INTERNAL_ERROR");
	}
}

export const createResponse = ResponseBuilder;
