/**
 * Adapter types for multi-source task management
 * Supports Linear, Trello, and future integrations
 */

export type TaskSourceType = "linear" | "trello";

// ============================================
// Source-agnostic data types
// ============================================

/**
 * Unified team/board concept
 * Linear: Team, Trello: Board
 */
export interface SourceTeam {
	id: string;
	name: string;
	icon?: string;
}

/**
 * Unified user/member concept
 */
export interface SourceUser {
	id: string;
	email?: string;
	displayName: string;
	avatarUrl?: string;
}

/**
 * Unified status concept
 * Linear: Workflow State, Trello: List
 */
export interface SourceStatus {
	id: string;
	name: string;
	type?: string; // Linear has type (unstarted/started/completed), Trello doesn't
	position?: number; // For ordering
}

/**
 * Unified label concept
 */
export interface SourceLabel {
	id: string;
	name: string;
	color?: string;
}

/**
 * Unified cycle/sprint concept
 * Linear: Cycle, Trello: (optional, can use due date range)
 */
export interface SourceCycle {
	id: string;
	name: string;
	startDate?: string;
	endDate?: string;
}

/**
 * Unified attachment concept
 */
export interface SourceAttachment {
	id: string;
	title: string;
	url: string;
	sourceType?: string;
}

/**
 * Unified comment concept
 */
export interface SourceComment {
	id: string;
	body: string;
	createdAt: string;
	user?: string;
}

/**
 * Unified issue/card concept
 */
export interface SourceIssue {
	id: string; // External display ID (e.g., MP-123, card shortLink)
	sourceId: string; // Internal UUID
	title: string;
	description?: string;
	status: string; // Status name
	statusId: string; // Status ID (for updates)
	assigneeId?: string;
	assigneeEmail?: string;
	priority: number; // Normalized to 0-4 (0=none, 1=urgent, 2=high, 3=medium, 4=low)
	labels: string[];
	url?: string;
	parentIssueId?: string;
	branchName?: string;
	attachments?: SourceAttachment[];
	comments?: SourceComment[];
}

// ============================================
// Adapter interface
// ============================================

/**
 * Options for fetching issues
 */
export interface GetIssuesOptions {
	teamId: string;
	cycleId?: string;
	statusNames?: string[]; // Filter by status names
	labelName?: string; // Filter by label
	assigneeEmail?: string; // Filter by assignee
	excludeLabels?: string[]; // Exclude issues with these labels
	limit?: number; // Max number of issues to return
}

/**
 * Result of initialization data fetch
 */
export interface InitData {
	teams: SourceTeam[];
	users: SourceUser[];
	statuses: SourceStatus[];
	labels: SourceLabel[];
	currentCycle?: SourceCycle;
}

/**
 * Main adapter interface for task sources
 */
export interface TaskSourceAdapter {
	readonly type: TaskSourceType;

	/**
	 * Validate connection and credentials
	 */
	validateConnection(): Promise<boolean>;

	/**
	 * Get all teams/boards accessible to the user
	 */
	getTeams(): Promise<SourceTeam[]>;

	/**
	 * Get users/members for a specific team/board
	 */
	getUsers(teamId: string): Promise<SourceUser[]>;

	/**
	 * Get workflow states/lists for a specific team/board
	 */
	getStatuses(teamId: string): Promise<SourceStatus[]>;

	/**
	 * Get labels for a specific team/board
	 */
	getLabels(teamId: string): Promise<SourceLabel[]>;

	/**
	 * Get the current active cycle (if applicable)
	 * Returns null for sources without cycle concept
	 */
	getCurrentCycle(teamId: string): Promise<SourceCycle | null>;

	/**
	 * Get issues/cards based on filter options
	 */
	getIssues(options: GetIssuesOptions): Promise<SourceIssue[]>;

	/**
	 * Get a single issue/card by ID
	 */
	getIssue(issueId: string): Promise<SourceIssue | null>;

	/**
	 * Search for an issue by identifier (e.g., MP-123, card shortLink)
	 */
	searchIssue(identifier: string): Promise<SourceIssue | null>;

	/**
	 * Update issue status (move to different workflow state/list)
	 */
	updateIssueStatus(
		sourceId: string,
		statusId: string,
	): Promise<{ success: boolean; error?: string }>;

	/**
	 * Add a comment to an issue
	 */
	addComment(
		sourceId: string,
		body: string,
	): Promise<{ success: boolean; error?: string }>;

	/**
	 * Get all initialization data in a single call (optimization)
	 */
	getInitData(teamId?: string): Promise<InitData>;
}

// ============================================
// Priority mapping helpers
// ============================================

/**
 * Standard priority values (matching Linear's convention)
 * 0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low
 */
export const STANDARD_PRIORITIES = {
	none: 0,
	urgent: 1,
	high: 2,
	medium: 3,
	low: 4,
} as const;

/**
 * Priority label patterns for Trello
 * Used to detect priority from card labels
 */
export const PRIORITY_LABEL_PATTERNS = {
	urgent: /^(urgent|critical|p0|p1)$/i,
	high: /^(high|important|p2)$/i,
	medium: /^(medium|normal|p3)$/i,
	low: /^(low|minor|p4)$/i,
} as const;

/**
 * Detect priority from label names
 */
export function detectPriorityFromLabels(labels: string[]): number {
	for (const label of labels) {
		if (PRIORITY_LABEL_PATTERNS.urgent.test(label))
			return STANDARD_PRIORITIES.urgent;
		if (PRIORITY_LABEL_PATTERNS.high.test(label))
			return STANDARD_PRIORITIES.high;
		if (PRIORITY_LABEL_PATTERNS.medium.test(label))
			return STANDARD_PRIORITIES.medium;
		if (PRIORITY_LABEL_PATTERNS.low.test(label)) return STANDARD_PRIORITIES.low;
	}
	return STANDARD_PRIORITIES.none;
}
