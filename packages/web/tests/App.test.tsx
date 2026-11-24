import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import App from "../src/App";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockSeats = [
	{
		id: 1,
		number: "A1",
		status: "available",
		lockedBy: null,
		lockedAt: null,
		reservedBy: null,
		reservedAt: null,
		priceInCents: 5000,
	},
	{
		id: 2,
		number: "A2",
		status: "reserved",
		lockedBy: null,
		lockedAt: null,
		reservedBy: 2,
		reservedAt: "2026-06-13T12:00:00Z",
		priceInCents: 5000,
	},
];

describe("App", () => {
	beforeEach(() => {
		mockFetch.mockReset();
		localStorage.clear();

		// Default mock implementation matching endpoints
		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/seats")) {
				return Promise.resolve({
					json: () =>
						Promise.resolve({ success: true, data: { seats: mockSeats } }),
				});
			}
			if (url.includes("/auth/me")) {
				return Promise.resolve({
					json: () => Promise.resolve({ authenticated: false }),
				});
			}
			return Promise.resolve({
				json: () => Promise.resolve({ success: true }),
			});
		});
	});

	it("shows loading state initially", () => {
		mockFetch.mockImplementation(() => new Promise(() => {}));
		const { getByText } = render(<App />);
		expect(getByText("Loading...")).toBeInTheDocument();
	});

	it("shows login notice when not authenticated", async () => {
		const { getByText } = render(<App />);

		await waitFor(() => {
			expect(getByText("Sign in below to reserve a seat")).toBeInTheDocument();
		});
	});

	it("shows seat map with seats", async () => {
		const { getByText, getAllByText } = render(<App />);

		await waitFor(() => {
			expect(getByText("A1")).toBeInTheDocument();
			expect(getByText("A2")).toBeInTheDocument();
			expect(getAllByText("$50.00").length).toBe(2);
		});
	});

	it("renders the concurrency tester user list", async () => {
		const { getByText } = render(<App />);

		await waitFor(() => {
			expect(getByText("Alice Smith")).toBeInTheDocument();
			expect(getByText("Bob Jones")).toBeInTheDocument();
			expect(getByText("Charlie Brown")).toBeInTheDocument();
		});
	});
});
