import { describe, expect, it } from "bun:test";
import { ResponseBuilder } from "../src/utils/response";

describe("Response Builder", () => {
	describe("success responses", () => {
		it("should create a basic success response", () => {
			const data = { message: "Success" };
			const response = ResponseBuilder.success(data);

			expect(response).toEqual({
				success: true,
				data: { message: "Success" },
				meta: {
					timestamp: expect.any(String),
				},
			});
		});

		it("should create a success response with additional meta", () => {
			const data = { users: [] };
			const meta = { requestId: "test-123" };
			const response = ResponseBuilder.success(data, meta);

			expect(response).toEqual({
				success: true,
				data: { users: [] },
				meta: {
					timestamp: expect.any(String),
					requestId: "test-123",
				},
			});
		});

		it("should create a paginated response", () => {
			const data = [{ id: 1 }, { id: 2 }];
			const response = ResponseBuilder.paginated(data, 1, 10, 25);

			expect(response).toEqual({
				success: true,
				data: [{ id: 1 }, { id: 2 }],
				meta: {
					timestamp: expect.any(String),
					page: 1,
					limit: 10,
					total: 25,
					totalPages: 3,
				},
			});
		});
	});

	describe("error responses", () => {
		it("should create a basic error response", () => {
			const response = ResponseBuilder.error("Something went wrong");

			expect(response).toEqual({
				success: false,
				error: {
					message: "Something went wrong",
				},
				meta: {
					timestamp: expect.any(String),
				},
			});
		});

		it("should create an error response with code", () => {
			const response = ResponseBuilder.error(
				"Validation failed",
				"VALIDATION_ERROR",
			);

			expect(response).toEqual({
				success: false,
				error: {
					message: "Validation failed",
					code: "VALIDATION_ERROR",
				},
				meta: {
					timestamp: expect.any(String),
				},
			});
		});

		it("should create unauthorized response", () => {
			const response = ResponseBuilder.unauthorized();

			expect(response).toEqual({
				success: false,
				error: {
					message: "Unauthorized",
					code: "UNAUTHORIZED",
				},
				meta: {
					timestamp: expect.any(String),
				},
			});
		});

		it("should create forbidden response", () => {
			const response = ResponseBuilder.forbidden("Access denied");

			expect(response).toEqual({
				success: false,
				error: {
					message: "Access denied",
					code: "FORBIDDEN",
				},
				meta: {
					timestamp: expect.any(String),
				},
			});
		});

		it("should create not found response", () => {
			const response = ResponseBuilder.notFound("User not found");

			expect(response).toEqual({
				success: false,
				error: {
					message: "User not found",
					code: "NOT_FOUND",
				},
				meta: {
					timestamp: expect.any(String),
				},
			});
		});

		it("should create validation error response", () => {
			const response = ResponseBuilder.validation("Invalid input");

			expect(response).toEqual({
				success: false,
				error: {
					message: "Invalid input",
					code: "VALIDATION_ERROR",
				},
				meta: {
					timestamp: expect.any(String),
				},
			});
		});

		it("should create internal server error response", () => {
			const response = ResponseBuilder.internal("Database connection failed");

			expect(response).toEqual({
				success: false,
				error: {
					message: "Database connection failed",
					code: "INTERNAL_ERROR",
				},
				meta: {
					timestamp: expect.any(String),
				},
			});
		});
	});
});
