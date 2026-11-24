/**
 * Example component demonstrating OpenAPI usage
 * This component shows how to make type-safe API calls
 */

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { getCurrentAuthUser, googleLogin, logout } from "../lib/queries";

interface User {
	id: number;
	email: string;
	name: string | null;
	picture?: string;
}

const VALID_PICTURE_ORIGINS = [
	"https://lh3.googleusercontent.com",
	"https://googleusercontent.com",
];

function isValidPictureUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return (
			parsed.protocol === "https:" &&
			VALID_PICTURE_ORIGINS.some((origin) => url.startsWith(origin))
		);
	} catch {
		return false;
	}
}

export function OpenApiExample() {
	const [user, setUser] = useState<User | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Example: Check authentication status on mount
	useEffect(() => {
		async function checkAuth() {
			try {
				const authData = await getCurrentAuthUser();
				if (authData.authenticated && authData.user) {
					setUser(authData.user);
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to check auth");
			} finally {
				setLoading(false);
			}
		}

		checkAuth();
	}, []);

	// Example: Login with Google
	const handleLogin = async () => {
		try {
			const authUrlData = await googleLogin();
			if (authUrlData.authUrl) {
				window.location.href = authUrlData.authUrl;
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to login");
		}
	};

	// Example: Logout
	const handleLogout = async () => {
		try {
			await logout();
			setUser(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to logout");
		}
	};

	// Example: Update user profile
	const handleUpdateProfile = async (name: string) => {
		try {
			if (!user) return;

			const response = await api.PATCH("/users/me", {
				body: { name },
			});

			if (response.data) {
				setUser(response.data);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to update profile");
		}
	};

	// Example: Direct API call with OpenAPI client
	const handleDirectApiCall = async () => {
		try {
			const response = await api.GET("/");
			console.log("Root API data:", response.data);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Direct API call failed");
		}
	};

	if (loading) {
		return <div>Loading...</div>;
	}

	return (
		<div className="p-6 max-w-4xl mx-auto">
			<h2 className="text-2xl font-bold mb-6">OpenAPI Example</h2>

			{error && (
				<div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
					{error}
				</div>
			)}

			{user ? (
				<div className="space-y-4">
					<div className="bg-gray-100 p-4 rounded">
						<h3 className="font-semibold mb-2">Logged in as:</h3>
						<p>ID: {user.id}</p>
						<p>Email: {user.email}</p>
						<p>Name: {user.name || "Not set"}</p>
						{user.picture && isValidPictureUrl(user.picture) && (
							<img
								src={user.picture}
								alt="Profile"
								className="w-16 h-16 rounded-full mt-2"
							/>
						)}
					</div>

					<div className="space-x-2">
						<button
							onClick={() => handleUpdateProfile("New Name")}
							type="button"
							className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
						>
							Update Name
						</button>
						<button
							onClick={handleLogout}
							type="button"
							className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
						>
							Logout
						</button>
					</div>
				</div>
			) : (
				<div className="space-y-4">
					<p>Not logged in</p>
					<button
						onClick={handleLogin}
						type="button"
						className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
					>
						Login with Google
					</button>
				</div>
			)}

			<div className="mt-6">
				<button
					onClick={handleDirectApiCall}
					type="button"
					className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
				>
					Test Direct API Call
				</button>
			</div>

			<div className="mt-8 bg-gray-50 p-4 rounded">
				<h3 className="font-semibold mb-2">Type Safety Benefits:</h3>
				<ul className="list-disc list-inside space-y-1 text-sm">
					<li>Full TypeScript autocompletion on API routes</li>
					<li>Compile-time type checking of request/response data</li>
					<li>No need to manually type API responses</li>
					<li>Automatic error handling with type narrowing</li>
					<li>
						Refactoring support - route changes are caught at compile time
					</li>
					<li>Standard OpenAPI specification for better tooling</li>
				</ul>
			</div>
		</div>
	);
}
