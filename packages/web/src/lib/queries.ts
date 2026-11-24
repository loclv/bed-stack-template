import { api, handleApiResponse } from "./api";
import type { operations } from "./api-types";

export async function getRootData() {
	const response = await api.GET("/");
	return handleApiResponse(response);
}

export async function getAuthStatus() {
	const response = await api.GET("/auth/me");
	return handleApiResponse(response);
}

export async function logout() {
	const response = await api.POST("/auth/logout");
	return handleApiResponse(response);
}

export async function refreshAuth() {
	const response = await api.POST("/auth/refresh");
	return handleApiResponse(response);
}

export async function mockLogin(
	body: operations["postAuthMockLogin"]["requestBody"]["content"]["application/json"],
) {
	const response = await api.POST("/auth/mock-login", { body });
	return handleApiResponse(response);
}

export async function getCurrentUser() {
	const response = await api.GET("/users/me");
	return handleApiResponse(response);
}

export async function updateCurrentUser(
	body: {
		name?: string;
		picture?: string;
	},
	csrfToken?: string,
) {
	const response = await api.PATCH("/users/me", {
		body,
		headers: csrfToken ? { "x-csrf-token": csrfToken } : undefined,
	});
	return handleApiResponse(response);
}

export async function getSeats() {
	const response = await api.GET("/seats");
	return handleApiResponse(response);
}

export async function lockSeat(id: string) {
	const response = await api.POST("/seats/{id}/lock", {
		params: { path: { id } },
	});
	return handleApiResponse(response);
}

export async function unlockSeat(id: string) {
	const response = await api.POST("/seats/{id}/unlock", {
		params: { path: { id } },
	});
	return handleApiResponse(response);
}

export async function reserveSeat(
	id: string,
	simulatedStatus?: "success" | "fail",
) {
	const response = await api.POST("/seats/{id}/reserve", {
		params: { path: { id } },
		body: { simulatedStatus },
	});
	return handleApiResponse(response);
}
