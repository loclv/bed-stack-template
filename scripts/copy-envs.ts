/**
 * Script to copy .env.example files to .env in the root and all service/package directories.
 * It detects if an existing .env is a symbolic link, and replaces it with a clean copy.
 */

import fs from "node:fs";
import path from "node:path";

const TARGETS = [
	{ name: "Root", dir: "." },
	{ name: "Auth Service", dir: "apps/auth-service" },
	{ name: "Seat Service", dir: "apps/seat-service" },
	{ name: "Payment Service", dir: "apps/payment-service" },
	{ name: "Web Package", dir: "packages/web" },
];

function processEnvFile(target: { name: string; dir: string }) {
	const rootDir = path.resolve(import.meta.dirname, "..");
	const targetDir = path.resolve(rootDir, target.dir);
	const examplePath = path.join(targetDir, ".env.example");
	const envPath = path.join(targetDir, ".env");

	console.log(`Processing ${target.name}...`);

	if (!fs.existsSync(examplePath)) {
		console.warn(`  Warning: ${examplePath} does not exist. Skipping.`);
		return;
	}

	let shouldCopy = false;

	if (fs.existsSync(envPath)) {
		const stat = fs.lstatSync(envPath);
		if (stat.isSymbolicLink()) {
			console.log(
				`  Found symbolic link at ${envPath}. Deleting symbolic link...`,
			);
			fs.unlinkSync(envPath);
			shouldCopy = true;
		} else {
			console.log(
				`  File .env already exists at ${target.dir}. Skipping to prevent overwriting existing settings.`,
			);
		}
	} else {
		shouldCopy = true;
	}

	if (shouldCopy) {
		console.log(`  Copying ${examplePath} -> ${envPath}`);
		fs.copyFileSync(examplePath, envPath);
	}
}

function main() {
	try {
		for (const target of TARGETS) {
			processEnvFile(target);
		}
		console.log("\nAll environment configurations set up successfully!");
	} catch (error) {
		console.error("Failed to copy environment files:", error);
		process.exit(1);
	}
}

main();
