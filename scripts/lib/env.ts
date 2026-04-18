/**
 * Minimal .env file loader and writer.
 * No external dependency. Values already in process.env take precedence
 * over values loaded from the file.
 */

import fs from "node:fs/promises";

const ENV_LINE = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i;

function parseEnv(content: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const match = line.match(ENV_LINE);
		if (!match) continue;
		let value = match[2];
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		result[match[1]] = value;
	}
	return result;
}

function quoteIfNeeded(value: string): string {
	if (/[\s"'#]/.test(value)) {
		return `"${value.replace(/"/g, '\\"')}"`;
	}
	return value;
}

/** Populate process.env from envPath. Existing process.env values win. */
export async function loadDotEnv(envPath: string): Promise<void> {
	let content: string;
	try {
		content = await fs.readFile(envPath, "utf-8");
	} catch {
		return;
	}
	const parsed = parseEnv(content);
	for (const [key, value] of Object.entries(parsed)) {
		if (process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
}

/**
 * Read linear_api_key_env from local.toon and mirror the chosen env var
 * into LINEAR_API_KEY. No-op if local.toon is missing or the field is
 * absent/default. Uses substring parsing to avoid importing the Linear SDK
 * at CLI startup.
 */
export async function resolveLinearApiKey(localPath: string): Promise<void> {
	let content: string;
	try {
		content = await fs.readFile(localPath, "utf-8");
	} catch {
		return;
	}
	const match = content.match(
		/^linear_api_key_env\s*:\s*["']?([A-Z_][A-Z0-9_]*)["']?\s*$/im,
	);
	const envName = match?.[1];
	if (!envName || envName === "LINEAR_API_KEY") return;
	const value = process.env[envName];
	if (value) {
		process.env.LINEAR_API_KEY = value;
	}
}

/** Merge vars into envPath, preserving existing entries. Creates with 0600. */
export async function writeDotEnv(
	envPath: string,
	vars: Record<string, string>,
): Promise<void> {
	let existing: Record<string, string> = {};
	try {
		const content = await fs.readFile(envPath, "utf-8");
		existing = parseEnv(content);
	} catch {
		// no existing file
	}
	const merged = { ...existing, ...vars };
	const body = `${Object.entries(merged)
		.map(([k, v]) => `${k}=${quoteIfNeeded(v)}`)
		.join("\n")}\n`;
	await fs.writeFile(envPath, body, { mode: 0o600 });
}
