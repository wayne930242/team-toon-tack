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
	label?: string;
	force?: boolean;
	interactive?: boolean;
}

export interface InitPaths {
	baseDir: string;
	configPath: string;
	localPath: string;
	cyclePath: string;
	outputPath: string;
}

// Re-export common types used in init
export type { TaskSourceType };
