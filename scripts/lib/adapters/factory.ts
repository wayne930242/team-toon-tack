/**
 * Adapter factory for creating task source adapters
 */

import type { Config } from "../../utils.js";
import { LinearAdapter } from "./linear-adapter.js";
import { TrelloAdapter } from "./trello-adapter.js";
import type { TaskSourceAdapter, TaskSourceType } from "./types.js";

/**
 * Get the source type from config, defaulting to "linear" for backwards compatibility
 */
export function getSourceType(config: Config): TaskSourceType {
	return config.source?.type ?? "linear";
}

/**
 * Create an adapter instance based on the source type in config
 */
export function createAdapter(config: Config): TaskSourceAdapter {
	const sourceType = getSourceType(config);

	switch (sourceType) {
		case "linear":
			return new LinearAdapter();

		case "trello": {
			const apiKey = config.source?.trello?.apiKey || process.env.TRELLO_API_KEY;
			const token = config.source?.trello?.token || process.env.TRELLO_TOKEN;

			if (!apiKey || !token) {
				console.error("Error: Trello credentials not configured.");
				console.error("Set TRELLO_API_KEY and TRELLO_TOKEN environment variables,");
				console.error("or run 'ttt init --source=trello' to configure.");
				process.exit(1);
			}

			return new TrelloAdapter(apiKey, token);
		}

		default:
			console.error(`Error: Unknown source type "${sourceType}"`);
			process.exit(1);
	}
}

/**
 * Create an adapter for initialization (before config exists)
 */
export function createAdapterForInit(
	sourceType: TaskSourceType,
	credentials?: { apiKey?: string; token?: string },
): TaskSourceAdapter {
	switch (sourceType) {
		case "linear":
			return new LinearAdapter();

		case "trello": {
			const apiKey = credentials?.apiKey || process.env.TRELLO_API_KEY;
			const token = credentials?.token || process.env.TRELLO_TOKEN;

			if (!apiKey || !token) {
				throw new Error("Trello API key and token are required");
			}

			return new TrelloAdapter(apiKey, token);
		}

		default:
			throw new Error(`Unknown source type: ${sourceType}`);
	}
}

/**
 * Check if the given source type is valid
 */
export function isValidSourceType(type: string): type is TaskSourceType {
	return type === "linear" || type === "trello";
}
