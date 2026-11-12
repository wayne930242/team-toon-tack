/**
 * The local task source: a Linear-shaped work board kept under
 * `.ttt/local/`, with no remote service behind it.
 *
 *   .ttt/local/board.toon          team, next issue number, statuses, labels
 *   .ttt/local/issues/<ID>.toon    one issue per file
 *   .ttt/local/.lock               held while any of the above is written
 */

/** Workflow state types, as Linear names them. */
export const LOCAL_STATUS_TYPES = [
	"backlog",
	"unstarted",
	"started",
	"completed",
	"canceled",
] as const;
export type LocalStatusType = (typeof LOCAL_STATUS_TYPES)[number];

export interface LocalStatusDef {
	/** Stable id the adapter hands out as `statusId` */
	id: string;
	name: string;
	type: LocalStatusType;
}

export interface LocalLabelDef {
	id: string;
	name: string;
	color?: string;
}

export interface LocalCycle {
	id: string;
	name: string;
	start_date?: string;
	end_date?: string;
}

export interface LocalBoard {
	version: 1;
	team: { key: string; name: string };
	/**
	 * Number the next issue gets. It only grows: a number once handed out is
	 * never handed out again, even if the issue file is removed.
	 */
	next_number: number;
	statuses: LocalStatusDef[];
	labels: LocalLabelDef[];
	current_cycle?: LocalCycle;
}

/**
 * `blocks` and `blocked_by` are two sides of one relation; the store writes
 * both issues. `related` is symmetric.
 */
export const LOCAL_RELATION_TYPES = [
	"blocks",
	"blocked_by",
	"related",
] as const;
export type LocalRelationType = (typeof LOCAL_RELATION_TYPES)[number];

export interface LocalRelation {
	type: LocalRelationType;
	/** Identifier of the other issue */
	issue: string;
}

export interface LocalComment {
	id: string;
	body: string;
	/** Display name of the author */
	user?: string;
	created_at: string;
}

export interface LocalIssue {
	/** `<TEAM KEY>-<number>`, e.g. MP-12 */
	identifier: string;
	number: number;
	title: string;
	description?: string;
	/** Status name, one of board.statuses */
	state: string;
	/** 0 none, 1 urgent, 2 high, 3 medium, 4 low */
	priority: number;
	/** Label names, each one of board.labels */
	labels: string[];
	/** User id from config.toon users */
	assignee?: string;
	/** Estimate points, as Linear counts them */
	estimate?: number;
	/** Identifier of the parent issue; children are the issues naming it */
	parent?: string;
	relations: LocalRelation[];
	comments: LocalComment[];
	/** Cycle id from board.current_cycle at creation */
	cycle?: string;
	/** User id of whoever created it */
	creator?: string;
	created_at: string;
	updated_at: string;
	started_at?: string;
	completed_at?: string;
	canceled_at?: string;
}

export class LocalBoardError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LocalBoardError";
	}
}
