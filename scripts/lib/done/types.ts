/**
 * Done module type definitions
 */

import type { Config, LocalConfig, Task } from "../../utils.js";
import type { CommitInfo } from "../git.js";

export interface DoneArgs {
	issueId?: string;
	message?: string;
	fromRemote: boolean;
}

export interface CompletionContext {
	task: Task;
	config: Config;
	localConfig: LocalConfig;
	commit: CommitInfo | null;
	aiMessage: string;
}

export interface CompletionResult {
	success: boolean;
	status?: string;
	message?: string;
}

export interface ParentUpdateResult {
	success: boolean;
	status?: string;
	testingStatus?: string;
}
