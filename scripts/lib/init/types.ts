/**
 * Init module type definitions
 */

import type { TaskSourceType } from "../adapters/types.js";

export interface InitOptions {
	source?: TaskSourceType;
	apiKey?: string;
	trelloApiKey?: string;
	trelloToken?: string;
	user?: string;
	team?: string;
	labels?: string[];
	/** Local source: team display name */
	teamName?: string;
	/** Local source: the current user's email */
	email?: string;
	/** Local source: other team members' names */
	members?: string[];
	/** Local source: "Todo, Doing:started, Done" */
	statuses?: string;
	force?: boolean;
	interactive?: boolean;
}

export interface InitPaths {
	baseDir: string;
	configPath: string;
	localPath: string;
	cyclePath: string;
	outputPath: string;
	envPath: string;
}

// Re-export common types used in init
export type { TaskSourceType };
