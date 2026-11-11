/**
 * Work order: one file per train batch that carries its tickets from claim
 * to Done. Field names are the on-disk (TOON) names.
 */

export const ORDER_STAGES = ["open", "sealed", "merged", "closed"] as const;
/**
 * open: accepts tickets. sealed: the batch is fixed and gated. merged: the
 * train's merge is recorded but not every ticket is Done yet. closed: done.
 */
export type OrderStage = (typeof ORDER_STAGES)[number];

export const TICKET_STATES = [
	"in-progress",
	"in-review",
	"dropped",
	"done",
] as const;
export type OrderTicketState = (typeof TICKET_STATES)[number];

/** One passed or failed test run recorded for a ticket. */
export interface OrderTestRun {
	/** The command with its filter, as it was run */
	command: string;
	/** Commit the run covered */
	sha: string;
	result: string;
	at: string;
}

export interface OrderTicket {
	id: string;
	state: OrderTicketState;
	branch?: string;
	mr?: string;
	head?: string;
	/** Review verdict, e.g. "P0/P1=0 @1a2b3c4" */
	review?: string;
	tests: OrderTestRun[];
	/** Why the ticket was dropped from the batch */
	reason?: string;
}

export interface OrderTrain {
	branch?: string;
	mr?: string;
	/** Train head the gate passed on; set by seal */
	gated_head?: string;
	/** Merge commit on the integration branch; set by close */
	merged_commit?: string;
	version?: string;
}

export interface OrderLogEntry {
	at: string;
	by: string;
	event: string;
}

/** Set on the copy its owner handed off: that copy is read-only. */
export interface OrderHandoff {
	at: string;
	by: string;
}

export interface WorkOrder {
	/** `<project>/<code>` */
	id: string;
	/** The one writer of this copy */
	owner: string;
	reviewer?: string;
	stage: OrderStage;
	/** Bumped on every write; an import refuses a copy older than the local one */
	rev: number;
	handed_off?: OrderHandoff;
	train: OrderTrain;
	tickets: OrderTicket[];
	log: OrderLogEntry[];
}

/** A rule of the order was broken; the message says what to do instead. */
export class OrderError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OrderError";
	}
}
