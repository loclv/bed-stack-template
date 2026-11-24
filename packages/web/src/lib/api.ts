/**
 * Type-safe API client using OpenAPI.
 * Provides end-to-end type safety between frontend and backend.
 *
 * Usage:
 * ```typescript
 * import { api } from './api';
 *
 * // Get request to root endpoint
 * const { data, error } = await api.GET('/');
 *
 * // Get current user
 * const { data, error } = await api.GET('/auth/me');
 *
 * // Post request with body
 * const { data, error } = await api.POST('/tasks', {
 *   body: { title: 'New Task' }
 * });
 *
 * // Patch request
 * const { data, error } = await api.PATCH('/users/me', {
 *   body: { name: 'John' }
 * });
 * ```
 */

import createClient from "openapi-fetch";
import type { paths } from "./api-types";

// Get API base URL from environment or default to localhost
const apiUrl = import.meta.env.PUBLIC_API_URL || "http://localhost:3000";

/**
 * Type-safe API client instance using openapi-fetch
 */
export const api = createClient<paths>({
	baseUrl: apiUrl,
	credentials: "include", // Include cookies for authentication
});

/**
 * Helper function to handle API responses
 * Throws an error if the response contains an error
 */
export async function handleApiResponse<T>(response: {
	data?: T;
	error?: unknown;
}) {
	if (response.error) {
		// Parse the error message from response.error
		const errorMessage =
			typeof response.error === "string"
				? response.error
				: JSON.stringify(response.error);
		console.error("API error:", errorMessage);
		throw new Error(errorMessage);
	}

	if (!response.data) {
		throw new Error("No data received from API");
	}

	return response.data;
}
