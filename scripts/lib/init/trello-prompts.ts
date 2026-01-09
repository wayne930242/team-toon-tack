/**
 * Trello-specific prompt functions for init
 */

import prompts from "prompts";
import { TrelloClient } from "../trello.js";
import type { InitOptions } from "./types.js";

export interface TrelloCredentials {
	apiKey: string;
	token: string;
}

export async function promptForTrelloCredentials(
	options: InitOptions,
): Promise<TrelloCredentials | null> {
	let apiKey = options.trelloApiKey || process.env.TRELLO_API_KEY;
	let token = options.trelloToken || process.env.TRELLO_TOKEN;

	if (!apiKey && options.interactive) {
		console.log("\n🔑 Trello API Credentials:");
		console.log("   Get your API key from: https://trello.com/power-ups/admin");

		const keyResponse = await prompts({
			type: "text",
			name: "apiKey",
			message: "Enter your Trello API key:",
			validate: (v) => (v.length > 10 ? true : "API key seems too short"),
		});
		apiKey = keyResponse.apiKey;
	}

	if (!apiKey) {
		return null;
	}

	if (!token && options.interactive) {
		// Generate authorization URL
		const authUrl = TrelloClient.getAuthorizationUrl(apiKey);
		console.log("\n   To get your token, visit this URL and authorize:");
		console.log(`   ${authUrl}`);

		const tokenResponse = await prompts({
			type: "password",
			name: "token",
			message: "Enter the token from the page:",
		});
		token = tokenResponse.token;
	}

	if (!token) {
		return null;
	}

	// Validate credentials
	const client = new TrelloClient(apiKey, token);
	const isValid = await client.validateCredentials();

	if (!isValid) {
		console.error("Error: Invalid Trello credentials.");
		return null;
	}

	console.log("  ✓ Trello credentials validated");
	return { apiKey, token };
}
