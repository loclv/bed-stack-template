import { useCallback, useEffect, useState } from "react";
import "./App.css";
import type { Seat, User } from "./types";

const API_URL = import.meta.env.PUBLIC_API_URL || "http://localhost:3000";

let csrfTokenValue = "";

/**
 * Get the CSRF HMAC signature to send as x-csrf-token header.
 * This is the server-computed HMAC of the cookie nonce, stored in memory.
 */
function getCsrfToken(): string {
	return csrfTokenValue;
}

/**
 * Store the CSRF HMAC signature received from the server.
 */
function setCsrfToken(token: string) {
	csrfTokenValue = token;
}

async function fetchWithAuth(
	path: string,
	options: RequestInit = {},
): Promise<Response> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	const method = (options.method || "GET").toUpperCase();
	if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
		const csrf = getCsrfToken();
		if (csrf) headers["x-csrf-token"] = csrf;
	}

	const doFetch = (): Promise<Response> =>
		fetch(`${API_URL}${path}`, {
			credentials: "include",
			headers: {
				...headers,
				...((options.headers as Record<string, string>) || {}),
			},
			...options,
		});

	let res = await doFetch();

	if (res.status === 401) {
		// Attempt token refresh — include CSRF header for refresh endpoint
		const csrf = getCsrfToken();
		const refreshHeaders: Record<string, string> = {};
		if (csrf) refreshHeaders["x-csrf-token"] = csrf;

		const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
			method: "POST",
			credentials: "include",
			headers: refreshHeaders,
		});

		if (refreshRes.ok) {
			const refreshData = await refreshRes.json().catch(() => ({}));
			if (refreshData.data?.csrfToken) setCsrfToken(refreshData.data.csrfToken);
			const newCsrf = getCsrfToken();
			if (newCsrf) headers["x-csrf-token"] = newCsrf;
			res = await fetch(`${API_URL}${path}`, {
				credentials: "include",
				headers: {
					...headers,
					...((options.headers as Record<string, string>) || {}),
				},
				...options,
			});
		}
	}

	return res;
}

// Simulated users for quick local testing/concurrency evaluation
const TEST_USERS = [
	{ email: "alice@example.com", name: "Alice Smith" },
	{ email: "bob@example.com", name: "Bob Jones" },
	{ email: "charlie@example.com", name: "Charlie Brown" },
];

function App() {
	const [user, setUser] = useState<User | null>(null);
	const [seats, setSeats] = useState<Seat[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [successMsg, setSuccessMsg] = useState("");
	const [selectedSeat, setSelectedSeat] = useState<Seat | null>(null);

	// Lock timer state
	const [remainingSeconds, setRemainingSeconds] = useState<number>(0);

	// Mock checkout form state
	const [paymentOutcome, setPaymentOutcome] = useState<"success" | "fail">(
		"success",
	);
	const [processingPayment, setProcessingPayment] = useState(false);

	// Fetch all seats and identify if the currently locked seat is still ours
	const fetchSeats = useCallback(
		async (currentUser: User | null = user) => {
			try {
				const res = await fetch(`${API_URL}/seats`);
				const data = await res.json();
				if (data.success) {
					const fetchedSeats: Seat[] = data.data.seats;
					setSeats(fetchedSeats);

					// Update selected seat local state if status changed
					if (currentUser) {
						const currentLocked = fetchedSeats.find(
							(s) => s.status === "locked" && s.lockedBy === currentUser.id,
						);
						if (currentLocked) {
							setSelectedSeat(currentLocked);
						} else {
							setSelectedSeat(null);
						}
					} else {
						setSelectedSeat(null);
					}
				}
			} catch (err) {
				console.error("Failed to fetch seats:", err);
				setError("Failed to retrieve seat availability.");
			} finally {
				setLoading(false);
			}
		},
		[user],
	);

	// Check authentication status
	const checkAuth = useCallback(async () => {
		try {
			const res = await fetchWithAuth("/auth/me");
			const data = await res.json();
			if (data.data?.authenticated && data.data?.user) {
				setUser(data.data.user);
				if (data.data.csrfToken) setCsrfToken(data.data.csrfToken);
				await fetchSeats(data.data.user);
			} else {
				setUser(null);
				await fetchSeats(null);
			}
		} catch (err) {
			console.error("Auth check failed:", err);
			setError("Authentication connection error.");
			setLoading(false);
		}
	}, [fetchSeats]);

	useEffect(() => {
		checkAuth();
	}, [checkAuth]);

	// Poll seats status every 4 seconds to reflect changes from other concurrent users
	useEffect(() => {
		const interval = setInterval(() => {
			fetchSeats();
		}, 4000);
		return () => clearInterval(interval);
	}, [fetchSeats]);

	// Update local countdown timer for the selected/locked seat
	useEffect(() => {
		if (!selectedSeat?.lockedAt) {
			setRemainingSeconds(0);
			return;
		}

		const updateTimer = () => {
			const lockedTime = new Date(selectedSeat.lockedAt!).getTime();
			const elapsed = Date.now() - lockedTime;
			const remaining = Math.max(0, 5 * 60 * 1000 - elapsed);
			const seconds = Math.ceil(remaining / 1000);
			setRemainingSeconds(seconds);

			if (seconds <= 0) {
				setSelectedSeat(null);
				fetchSeats();
			}
		};

		updateTimer();
		const interval = setInterval(updateTimer, 1000);
		return () => clearInterval(interval);
	}, [selectedSeat, fetchSeats]);

	// Handle Simulated Quick Login
	const handleMockLogin = async (email: string, name: string) => {
		setError("");
		setSuccessMsg("");
		setLoading(true);
		try {
			const res = await fetchWithAuth("/auth/mock-login", {
				method: "POST",
				body: JSON.stringify({ email, name }),
			});
			const data = await res.json();
			if (data.success) {
				setUser(data.data.user);
				if (data.data.csrfToken) setCsrfToken(data.data.csrfToken);
				setError("");
				setSuccessMsg(
					`Logged in successfully as ${name}! Session valid for 90 days.`,
				);
				setSelectedSeat(null);
				await fetchSeats(data.data.user);
			} else {
				setError(data.error?.message || "Failed to log in.");
			}
		} catch (err) {
			console.error("Login failed:", err);
			setError("Login failed due to connection error.");
		} finally {
			setLoading(false);
		}
	};

	// Log out user
	const handleLogout = async () => {
		try {
			await fetchWithAuth("/auth/logout", { method: "POST" });
		} catch (err) {
			console.error("Logout request failed:", err);
		}
		setUser(null);
		setSelectedSeat(null);
		setSuccessMsg("Logged out successfully.");
		fetchSeats(null);
	};

	// Select and Lock a seat
	const handleSeatClick = async (seat: Seat) => {
		if (!user) {
			setError("Please sign in to select a seat.");
			return;
		}
		if (seat.status === "reserved") {
			return;
		}
		if (seat.status === "locked" && seat.lockedBy !== user.id) {
			setError("This seat is currently held by another user.");
			return;
		}

		setError("");
		setSuccessMsg("");

		try {
			const res = await fetchWithAuth(`/seats/${seat.id}/lock`, {
				method: "POST",
			});
			const data = await res.json();
			if (data.success) {
				await fetchSeats();
			} else {
				setError(data.error?.message || "Failed to select seat.");
			}
		} catch (err) {
			console.error("Failed to lock seat:", err);
			setError("Connection error while selecting seat.");
		}
	};

	// Release a seat lock (Cancel Checkout)
	const handleCancelCheckout = async () => {
		if (!selectedSeat) return;

		setError("");
		setSuccessMsg("");
		try {
			const res = await fetchWithAuth(`/seats/${selectedSeat.id}/unlock`, {
				method: "POST",
			});
			const data = await res.json();
			if (data.success) {
				setSelectedSeat(null);
				await fetchSeats();
				setSuccessMsg("Checkout cancelled. Seat released.");
			} else {
				setError(data.error?.message || "Failed to release seat.");
			}
		} catch (err) {
			console.error("Failed to unlock seat:", err);
			setError("Connection error while releasing seat.");
		}
	};

	// Complete mock checkout and reserve seat
	const handleReserveSeat = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedSeat) return;

		setError("");
		setSuccessMsg("");
		setProcessingPayment(true);

		// Artificial delay to simulate real payment processing animation
		setTimeout(async () => {
			try {
				const res = await fetchWithAuth(`/seats/${selectedSeat.id}/reserve`, {
					method: "POST",
					body: JSON.stringify({ simulatedStatus: paymentOutcome }),
				});
				const data = await res.json();
				if (data.success) {
					setSuccessMsg(
						`Seat ${selectedSeat.number} successfully reserved! Payment transaction complete.`,
					);
					setSelectedSeat(null);
					await fetchSeats();
				} else {
					setError(
						data.error?.message || "Payment processing failed. Try again.",
					);
				}
			} catch (err) {
				console.error("Payment reservation failed:", err);
				setError("Network error while completing reservation.");
			} finally {
				setProcessingPayment(false);
			}
		}, 1200);
	};

	// Formatter for checkout countdown timer
	const formatTime = (seconds: number) => {
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
	};

	// Get seat card styling based on state
	const getSeatStatusClass = (seat: Seat) => {
		if (seat.status === "reserved") return "seat-reserved";
		if (seat.status === "locked") {
			if (user && seat.lockedBy === user.id) return "seat-locked-mine";
			return "seat-locked-others";
		}
		return "seat-available";
	};

	if (loading) {
		return (
			<div className="content">
				<p>Loading...</p>
			</div>
		);
	}

	return (
		<div className="app-container">
			<header className="app-header">
				<div className="header-left">
					<div className="app-logo">💺</div>
					<h1>SeatFlow</h1>
				</div>
				<div className="header-right">
					{user ? (
						<div className="user-profile">
							<span className="user-name">👤 {user.name || user.email}</span>
							<button
								type="button"
								onClick={handleLogout}
								className="btn btn-logout"
							>
								Sign Out
							</button>
						</div>
					) : (
						<span className="auth-notice">Sign in below to reserve a seat</span>
					)}
				</div>
			</header>

			<main className="app-main">
				<div className="main-content-layout">
					{/* Left Section: Instructions & Multi-User Switcher */}
					<section className="dashboard-card intro-card">
						<h2>Real-time Seat Reservation</h2>
						<p className="subtitle">
							Demonstrating concurrency controls, seat locking, and session
							lifecycle.
						</p>

						<div className="lifecycle-badge">
							🔒 Secure JWT Session Expiration: <strong>90 Days</strong>
						</div>

						{/* Developer Multi-User Switcher */}
						<div className="developer-box">
							<h3>👥 Concurrency Tester (Sign in as different users)</h3>
							<p className="developer-desc">
								Click any profile to log in instantly. Switch users to test that
								seat locks and reservations update in real-time across users.
							</p>
							<div className="user-grid">
								{TEST_USERS.map((u) => {
									const isActive = user?.email === u.email;
									return (
										<button
											key={u.email}
											type="button"
											className={`user-card-btn ${isActive ? "active" : ""}`}
											onClick={() => handleMockLogin(u.email, u.name)}
										>
											<div className="user-avatar">
												{u.name
													.split(" ")
													.map((n) => n[0])
													.join("")}
											</div>
											<div className="user-info">
												<span className="name">{u.name}</span>
												<span className="email">{u.email}</span>
											</div>
											{isActive && <span className="active-dot" />}
										</button>
									);
								})}
							</div>
						</div>
					</section>

					{/* Notification Banners */}
					{error && <div className="banner banner-error">{error}</div>}
					{successMsg && (
						<div className="banner banner-success">{successMsg}</div>
					)}

					{/* Middle Section: Seat Map */}
					<section className="dashboard-card seat-map-card">
						<h2>Select Your Seat</h2>
						<p className="seat-map-desc">
							We have 3 premium front-row seats. Pick an available seat to lock
							it for checkout.
						</p>

						<div className="seat-grid">
							{seats.map((seat) => {
								const statusClass = getSeatStatusClass(seat);
								const isMine =
									user && seat.status === "locked" && seat.lockedBy === user.id;
								const isOthers =
									user && seat.status === "locked" && seat.lockedBy !== user.id;

								return (
									<button
										key={seat.id}
										type="button"
										className={`seat-item ${statusClass}`}
										onClick={() => handleSeatClick(seat)}
										disabled={
											seat.status === "reserved" ||
											(seat.status === "locked" && !isMine)
										}
									>
										<div className="seat-icon">💺</div>
										<div className="seat-details">
											<span className="number">{seat.number}</span>
											<span className="price">{`$${(seat.priceInCents / 100).toFixed(2)}`}</span>
										</div>

										<div className="seat-badge">
											{seat.status === "reserved" && "Reserved"}
											{seat.status === "locked" &&
												isMine &&
												`Locked (${formatTime(remainingSeconds)})`}
											{seat.status === "locked" &&
												isOthers &&
												"Locked by other"}
											{seat.status === "available" && "Available"}
										</div>
									</button>
								);
							})}
						</div>

						<div className="legend">
							<div className="legend-item">
								<span className="dot dot-available" /> Available
							</div>
							<div className="legend-item">
								<span className="dot dot-locked-mine" /> Selected by You
							</div>
							<div className="legend-item">
								<span className="dot dot-locked-others" /> Locked by Other
							</div>
							<div className="legend-item">
								<span className="dot dot-reserved" /> Reserved
							</div>
						</div>
					</section>

					{/* Right Section: Checkout / Payment Panel */}
					{selectedSeat && (
						<section className="dashboard-card checkout-card slide-up">
							<div className="checkout-header">
								<h2>💳 Complete Checkout</h2>
								<div className="checkout-timer">
									⏳ Lock Expires in:{" "}
									<strong>{formatTime(remainingSeconds)}</strong>
								</div>
							</div>

							<div className="checkout-summary">
								<div className="summary-row">
									<span>Selected Seat</span>
									<strong>{selectedSeat.number}</strong>
								</div>
								<div className="summary-row">
									<span>Ticket Subtotal</span>
									<strong>{`$${(selectedSeat.priceInCents / 100).toFixed(2)}`}</strong>
								</div>
								<div className="summary-row total">
									<span>Amount Due</span>
									<strong>{`$${(selectedSeat.priceInCents / 100).toFixed(2)}`}</strong>
								</div>
							</div>

							<form onSubmit={handleReserveSeat} className="checkout-form">
								<h3>Demo Checkout</h3>
								<p className="text-sm opacity-70">
									This is a simulated payment. No real payment data is
									collected.
								</p>

								<div className="payment-simulator-option">
									<label htmlFor="payment-outcome">
										Simulate Payment Outcome:
									</label>
									<select
										id="payment-outcome"
										value={paymentOutcome}
										onChange={(e) =>
											setPaymentOutcome(e.target.value as "success" | "fail")
										}
										className="input"
									>
										<option value="success">
											✅ Simulate Successful Charge
										</option>
										<option value="fail">❌ Simulate Failed Charge</option>
									</select>
								</div>

								<div className="checkout-actions">
									<button
										type="button"
										onClick={handleCancelCheckout}
										className="btn btn-secondary"
										disabled={processingPayment}
									>
										Cancel
									</button>
									<button
										type="submit"
										className="btn btn-primary btn-pay"
										disabled={processingPayment}
									>
										{processingPayment
											? "Processing Payment..."
											: `Pay $${(selectedSeat.priceInCents / 100).toFixed(2)}`}
									</button>
								</div>
							</form>
						</section>
					)}
				</div>
			</main>
		</div>
	);
}

export default App;
