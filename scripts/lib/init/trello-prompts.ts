/**
 * Trello-specific prompt functions for init
 */

import { confirm, input, password } from "@inquirer/prompts";
import { TrelloClient } from "../trello.js";
import type { InitOptions } from "./types.js";

export interface TrelloCredentials {
	apiKey: string;
	token: string;
	/** true when BOTH apiKey and token came from pre-existing env vars */
	fromSystemEnv: boolean;
}

async function promptNewCredentials(): Promise<{
	apiKey: string;
	token: string;
} | null> {
	console.log("\n🔑 Trello API Credentials:");
	console.log("   Get your API key from: https://trello.com/power-ups/admin");

	const apiKey = await input({
		message: "Enter your Trello API key:",
		validate: (v) => (v.length > 10 ? true : "API key seems too short"),
	});
	if (!apiKey) return null;

	const authUrl = TrelloClient.getAuthorizationUrl(apiKey);
	console.log("\n   To get your token, visit this URL and authorize:");
	console.log(`   ${authUrl}`);

	const token = await password({
		message: "Enter the token from the page:",
	});
	if (!token) return null;

	return { apiKey, token };
}

export async function promptForTrelloCredentials(
	options: InitOptions,
): Promise<TrelloCredentials | null> {
	const flagKey = options.trelloApiKey;
	const flagToken = options.trelloToken;
	const envKey = process.env.TRELLO_API_KEY;
	const envToken = process.env.TRELLO_TOKEN;

	// Non-interactive: take whatever is available, no prompts
	if (!options.interactive) {
		const apiKey = flagKey || envKey;
		const token = flagToken || envToken;
		if (!apiKey || !token) return null;
		return {
			apiKey,
			token,
			fromSystemEnv: !flagKey && !flagToken && !!envKey && !!envToken,
		};
	}

	// CLI flags short-circuit the picker
	if (flagKey && flagToken) {
		return { apiKey: flagKey, token: flagToken, fromSystemEnv: false };
	}

	let apiKey: string | undefined;
	let token: string | undefined;
	let fromSystemEnv = false;

	// Offer the existing system env credentials, if any
	if (envKey && envToken) {
		console.log("\n🔑 Found Trello credentials in environment.");
		const useExisting = await confirm({
			message:
				"Use the existing TRELLO_API_KEY / TRELLO_TOKEN? (no = enter new credentials)",
			default: true,
		});
		if (useExisting) {
			apiKey = envKey;
			token = envToken;
			fromSystemEnv = true;
		}
	}

	// Fall through to manual entry
	if (!apiKey || !token) {
		const entered = await promptNewCredentials();
		if (!entered) return null;
		apiKey = entered.apiKey;
		token = entered.token;
		fromSystemEnv = false;
	}

	// Validate credentials
	const client = new TrelloClient(apiKey, token);
	const isValid = await client.validateCredentials();
	if (!isValid) {
		console.error("Error: Invalid Trello credentials.");
		return null;
	}

	console.log("  ✓ Trello credentials validated");
	return { apiKey, token, fromSystemEnv };
}
