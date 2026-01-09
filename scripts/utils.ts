import fs from "node:fs/promises";
import path from "node:path";
import { LinearClient } from "@linear/sdk";
import { decode, encode } from "@toon-format/toon";

// Resolve base directory - supports multiple configuration methods
function getBaseDir(): string {
	// 1. Check for TOON_DIR environment variable (set by CLI or user)
	if (process.env.TOON_DIR) {
		return path.resolve(process.env.TOON_DIR);
	}

	// 2. Check for legacy LINEAR_TOON_DIR environment variable
	if (process.env.LINEAR_TOON_DIR) {
		return path.resolve(process.env.LINEAR_TOON_DIR);
	}

	// 3. Default: .ttt directory in current working directory
	return path.join(process.cwd(), ".ttt");
}

const BASE_DIR = getBaseDir();
const CONFIG_PATH = path.join(BASE_DIR, "config.toon");
const CYCLE_PATH = path.join(BASE_DIR, "cycle.toon");
const LOCAL_PATH = path.join(BASE_DIR, "local.toon");
const OUTPUT_PATH = path.join(BASE_DIR, "output");

export function getPaths() {
	return {
		baseDir: BASE_DIR,
		configPath: CONFIG_PATH,
		cyclePath: CYCLE_PATH,
		localPath: LOCAL_PATH,
		outputPath: OUTPUT_PATH,
	};
}

export interface TeamConfig {
	id: string;
	name: string;
	icon?: string;
}

export interface UserConfig {
	id: string;
	email: string;
	displayName: string;
	role?: string;
}

export interface LabelConfig {
	id: string;
	name: string;
	color?: string;
}

export interface CycleInfo {
	id: string;
	name: string;
	start_date: string;
	end_date: string;
}

export interface StatusTransitions {
	todo: string; // Linear status name for "todo" tasks (e.g., 'Todo', 'Backlog')
	in_progress: string; // Linear status name for "in progress" tasks (e.g., 'In Progress')
	done: string; // Linear status name for "done" tasks (e.g., 'Done', 'Completed')
	testing?: string; // Linear status name for "testing" tasks (optional, e.g., 'Testing', 'In Review')
	blocked?: string; // Linear status name for "blocked" tasks (optional, e.g., 'Blocked', 'On Hold')
}

// QA/PM Team configuration with its testing status
export interface QaPmTeamConfig {
	team: string; // team key from config.teams
	testing_status: string; // testing status name for this team
}

// Completion mode determines how done-job handles task completion
export type CompletionMode =
	| "simple" // Mark task as done + parent as done (default when no QA/PM teams)
	| "strict_review" // Mark task to dev testing + parent to QA testing
	| "upstream_strict" // Mark task as done + parent to testing, fallback to dev testing if no parent (default when QA/PM teams set)
	| "upstream_not_strict"; // Mark task as done + parent to testing, no fallback

// Task source type for multi-source support
export type TaskSourceType = "linear" | "trello";

// Source configuration for different task management systems
export interface SourceConfig {
	type: TaskSourceType;
	// Trello-specific config (credentials stored in env vars for security)
	trello?: {
		apiKey?: string; // Usually from TRELLO_API_KEY env var
		token?: string; // Usually from TRELLO_TOKEN env var
	};
}

export interface Config {
	// Source configuration (defaults to Linear for backwards compatibility)
	source?: SourceConfig;
	teams: Record<string, TeamConfig>;
	users: Record<string, UserConfig>;
	labels?: Record<string, LabelConfig>;
	priorities?: Record<string, { value: number; name: string }>;
	statuses?: Record<string, { name: string; type: string }>;
	status_transitions?: StatusTransitions;
	priority_order?: string[]; // e.g., ['urgent', 'high', 'medium', 'low', 'none']
	current_cycle?: CycleInfo;
	cycle_history?: CycleInfo[];
}

// Linear priority value to name mapping (fixed by Linear API)
export const PRIORITY_NAMES: Record<number, string> = {
	0: "none",
	1: "urgent",
	2: "high",
	3: "medium",
	4: "low",
};

export const DEFAULT_PRIORITY_ORDER = [
	"urgent",
	"high",
	"medium",
	"low",
	"none",
];

export function getPrioritySortIndex(
	priority: number,
	priorityOrder?: string[],
): number {
	const order = priorityOrder ?? DEFAULT_PRIORITY_ORDER;
	const name = PRIORITY_NAMES[priority] ?? "none";
	const index = order.indexOf(name);
	return index === -1 ? order.length : index;
}

export interface Attachment {
	id: string;
	title: string;
	url: string;
	sourceType?: string;
	localPath?: string; // Local path for downloaded Linear images
}

export interface Comment {
	id: string;
	body: string;
	createdAt: string;
	user?: string;
}

export interface Task {
	id: string;
	/** @deprecated Use sourceId instead. Kept for backwards compatibility. */
	linearId: string;
	/** Internal ID from the source system (Linear UUID, Trello card ID, etc.) */
	sourceId?: string;
	/** Source type this task came from */
	sourceType?: TaskSourceType;
	title: string;
	status: string;
	localStatus:
		| "pending"
		| "in-progress"
		| "in-review"
		| "completed"
		| "blocked";
	assignee?: string;
	priority: number;
	labels: string[];
	branch?: string;
	description?: string;
	parentIssueId?: string;
	subIssues?: Task[];
	url?: string;
	attachments?: Attachment[];
	comments?: Comment[];
}

export interface CycleData {
	cycleId: string;
	cycleName: string;
	updatedAt: string;
	tasks: Task[];
}

export interface LocalConfig {
	current_user: string;
	team: string; // dev team key from config.teams (single dev team)
	dev_testing_status?: string; // dev team's testing/review status (optional)
	qa_pm_teams?: QaPmTeamConfig[]; // multiple QA/PM teams with their testing statuses
	completion_mode?: CompletionMode; // how done-job handles task completion
	exclude_labels?: string[];
	label?: string; // include only this label (optional filter)
	status_source?: "remote" | "local"; // 'remote' = update Linear immediately, 'local' = only update local until sync --update
	// Legacy fields (for backwards compatibility)
	teams?: string[]; // deprecated: use team (single dev team)
	qa_pm_team?: string; // deprecated: use qa_pm_teams
}

export async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function loadConfig(): Promise<Config> {
	try {
		const fileContent = await fs.readFile(CONFIG_PATH, "utf-8");
		return decode(fileContent) as unknown as Config;
	} catch (error) {
		console.error(`Error loading config from ${CONFIG_PATH}:`, error);
		console.error("Run `bun run init` to create configuration files.");
		process.exit(1);
	}
}

export async function loadLocalConfig(): Promise<LocalConfig> {
	try {
		const fileContent = await fs.readFile(LOCAL_PATH, "utf-8");
		return decode(fileContent) as unknown as LocalConfig;
	} catch {
		console.error(`Error: ${LOCAL_PATH} not found.`);
		console.error("Run `bun run init` to create local configuration.");
		process.exit(1);
	}
}

export async function getUserEmail(): Promise<string> {
	const localConfig = await loadLocalConfig();
	const config = await loadConfig();
	const user = config.users[localConfig.current_user];
	if (!user) {
		console.error(
			`Error: User "${localConfig.current_user}" not found in config.toon`,
		);
		console.error(`Available users: ${Object.keys(config.users).join(", ")}`);
		process.exit(1);
	}
	return user.email;
}

export function getLinearClient(): LinearClient {
	const apiKey = process.env.LINEAR_API_KEY;
	if (!apiKey) {
		console.error("Error: LINEAR_API_KEY environment variable is not set.");
		console.error(
			'Set it in your shell: export LINEAR_API_KEY="lin_api_xxxxx"',
		);
		process.exit(1);
	}
	return new LinearClient({ apiKey });
}

export async function loadCycleData(): Promise<CycleData | null> {
	try {
		await fs.access(CYCLE_PATH);
		const fileContent = await fs.readFile(CYCLE_PATH, "utf-8");
		return decode(fileContent) as unknown as CycleData;
	} catch {
		return null;
	}
}

export async function saveCycleData(data: CycleData): Promise<void> {
	const toonString = encode(data);
	await fs.writeFile(CYCLE_PATH, toonString, "utf-8");
}

export async function saveConfig(config: Config): Promise<void> {
	const toonString = encode(config);
	await fs.writeFile(CONFIG_PATH, toonString, "utf-8");
}

export async function saveLocalConfig(config: LocalConfig): Promise<void> {
	const toonString = encode(config);
	await fs.writeFile(LOCAL_PATH, toonString, "utf-8");
}

// Get first team key from config
export function getDefaultTeamKey(config: Config): string {
	const keys = Object.keys(config.teams);
	if (keys.length === 0) {
		console.error("Error: No teams defined in config.toon");
		process.exit(1);
	}
	return keys[0];
}

// Get team ID by key or return first team
export function getTeamId(config: Config, teamKey?: string): string {
	const key = teamKey || getDefaultTeamKey(config);
	const team = config.teams[key];
	if (!team) {
		console.error(`Error: Team "${key}" not found in config.toon`);
		console.error(`Available teams: ${Object.keys(config.teams).join(", ")}`);
		process.exit(1);
	}
	return team.id;
}

// Get source type from config, defaulting to "linear" for backwards compatibility
export function getSourceType(config: Config): TaskSourceType {
	return config.source?.type ?? "linear";
}

// Helper to get sourceId from Task, falling back to linearId for backwards compatibility
export function getTaskSourceId(task: Task): string {
	return task.sourceId ?? task.linearId;
}
