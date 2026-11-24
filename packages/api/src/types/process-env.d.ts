declare module "bun" {
	interface Env {
		API_PORT?: string;
		FRONTEND_URL: string;
	}
}
