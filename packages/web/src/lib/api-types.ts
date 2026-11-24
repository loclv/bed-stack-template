export interface paths {
	"/": {
		get: operations["getIndex"];
	};
	"/auth/google": {
		get: operations["getAuthGoogle"];
	};
	"/auth/callback": {
		get: operations["getAuthCallback"];
	};
	"/auth/me": {
		get: operations["getAuthMe"];
	};
	"/auth/logout": {
		post: operations["postAuthLogout"];
	};
	"/auth/refresh": {
		post: operations["postAuthRefresh"];
	};
	"/auth/mock-login": {
		post: operations["postAuthMockLogin"];
	};
	"/users/me": {
		get: operations["getUsersMe"];
		patch: operations["patchUsersMe"];
	};
	"/seats": {
		get: operations["getSeats"];
	};
	"/seats/{id}/lock": {
		post: operations["postSeatsIdLock"];
	};
	"/seats/{id}/unlock": {
		post: operations["postSeatsIdUnlock"];
	};
	"/seats/{id}/reserve": {
		post: operations["postSeatsIdReserve"];
	};
}

export type webhooks = Record<string, never>;

export interface components {
	schemas: {
		User: {
			id: number;
			email: string;
			name: string | null;
			picture: string | null;
		};
		Seat: {
			id: number;
			number: string;
			status: "available" | "locked" | "reserved";
			lockedBy: number | null;
			lockedAt: string | null;
			reservedBy: number | null;
			reservedAt: string | null;
			priceInCents: number;
		};
		Reservation: {
			id: number;
			seatId: number;
			userId: number;
			paymentIntentId: string;
			amountInCents: number;
			createdAt: string;
		};
		ApiResponse: {
			success: boolean;
			data?: Record<string, unknown>;
			error?: {
				message: string;
				code?: string;
			};
			meta: {
				timestamp: string;
			};
		};
	};
}

export type $defs = Record<string, never>;

export interface operations {
	getIndex: {
		responses: {
			200: {
				content: {
					"application/json": components["schemas"]["ApiResponse"] & {
						data: {
							message: string;
							users: Array<{
								id: number;
								email: string;
								name: string | null;
							}>;
						};
					};
				};
			};
		};
	};
	getAuthGoogle: {
		responses: {
			302: never;
		};
	};
	getAuthCallback: {
		parameters: {
			query: {
				code: string;
				state?: string;
				scope?: string;
			};
		};
		responses: {
			302: never;
		};
	};
	getAuthMe: {
		responses: {
			200: {
				content: {
					"application/json": components["schemas"]["ApiResponse"] & {
						data: {
							authenticated: boolean;
							user?: components["schemas"]["User"];
							csrfToken?: string | null;
						};
					};
				};
			};
		};
	};
	postAuthLogout: {
		requestBody?: never;
		responses: {
			200: {
				content: {
					"application/json": components["schemas"]["ApiResponse"] & {
						data: {
							success: boolean;
						};
					};
				};
			};
		};
	};
	postAuthRefresh: {
		responses: {
			200: {
				content: {
					"application/json": components["schemas"]["ApiResponse"] & {
						data: {
							authenticated: boolean;
							csrfToken?: string | null;
						};
					};
				};
			};
		};
	};
	postAuthMockLogin: {
		requestBody: {
			content: {
				"application/json": {
					email: string;
					name?: string;
				};
			};
		};
		responses: {
			200: {
				content: {
					"application/json": components["schemas"]["ApiResponse"] & {
						data: {
							token: string;
							user: components["schemas"]["User"];
							csrfToken: string;
						};
					};
				};
			};
		};
	};
	getUsersMe: {
		responses: {
			200: {
				content: {
					"application/json": components["schemas"]["ApiResponse"] & {
						data: {
							authenticated: boolean;
							user?: components["schemas"]["User"];
						};
					};
				};
			};
		};
	};
	patchUsersMe: {
		requestBody: {
			content: {
				"application/json": {
					name?: string;
					picture?: string;
				};
			};
		};
		responses: {
			200: {
				content: {
					"application/json": components["schemas"]["ApiResponse"] & {
						data: {
							user: components["schemas"]["User"];
						};
					};
				};
			};
		};
	};
	getSeats: {
		responses: {
			200: {
				content: {
					"application/json": components["schemas"]["ApiResponse"] & {
						data: {
							seats: components["schemas"]["Seat"][];
						};
					};
				};
			};
		};
	};
	postSeatsIdLock: {
		parameters: {
			path: {
				id: string;
			};
		};
		responses: {
			200: {
				content: {
					"application/json": components["schemas"]["ApiResponse"] & {
						data: {
							message: string;
							seatId: number;
						};
					};
				};
			};
		};
	};
	postSeatsIdUnlock: {
		parameters: {
			path: {
				id: string;
			};
		};
		responses: {
			200: {
				content: {
					"application/json": components["schemas"]["ApiResponse"] & {
						data: {
							message: string;
							seatId: number;
						};
					};
				};
			};
		};
	};
	postSeatsIdReserve: {
		parameters: {
			path: {
				id: string;
			};
		};
		requestBody: {
			content: {
				"application/json": {
					simulatedStatus?: "success" | "fail";
				};
			};
		};
		responses: {
			200: {
				content: {
					"application/json": components["schemas"]["ApiResponse"] & {
						data: {
							message: string;
							seat: components["schemas"]["Seat"];
							reservation: components["schemas"]["Reservation"];
						};
					};
				};
			};
		};
	};
}
