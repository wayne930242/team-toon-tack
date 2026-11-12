/**
 * Files of the local board. Every write holds `.ttt/local/.lock` across
 * read, change, write-to-temp, rename: two `ttt create` runs at once get two
 * numbers, and a crash leaves either the old file or the new one.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { decode, encode } from "@toon-format/toon";
import { getPaths } from "../../utils.js";
import { withFileLock } from "../file-lock.js";
import {
	LOCAL_RELATION_TYPES,
	LOCAL_STATUS_TYPES,
	type LocalBoard,
	LocalBoardError,
	type LocalComment,
	type LocalIssue,
	type LocalLabelDef,
	type LocalRelation,
	type LocalStatusDef,
} from "./types.js";

export function localBoardDir(): string {
	return path.join(getPaths().baseDir, "local");
}

function boardPath(): string {
	return path.join(localBoardDir(), "board.toon");
}

function issuesDir(): string {
	return path.join(localBoardDir(), "issues");
}

function issuePath(identifier: string): string {
	return path.join(issuesDir(), `${identifier}.toon`);
}

/** Drop undefined fields: TOON would write them as null. */
function compact<T extends object>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, v]) => v !== undefined),
	) as T;
}

function tempPath(file: string): string {
	return `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
	const temp = tempPath(file);
	try {
		await fs.writeFile(temp, encode(value), "utf8");
		await fs.rename(temp, file);
	} finally {
		await fs.rm(temp, { force: true });
	}
}

/**
 * Write a file that must not exist yet. It appears complete or not at all:
 * the content goes to a temp file, which is then hard-linked to the name
 * (refused with EEXIST when the name is taken, unlike rename).
 */
async function writeNew(file: string, value: unknown): Promise<void> {
	const temp = tempPath(file);
	try {
		await fs.writeFile(temp, encode(value), "utf8");
		await fs.link(temp, file);
	} finally {
		await fs.rm(temp, { force: true });
	}
}

async function readToon(file: string): Promise<unknown | undefined> {
	let content: string;
	try {
		content = await fs.readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	try {
		return decode(content, { strict: false });
	} catch (error) {
		throw new LocalBoardError(
			`${file}: ${error instanceof Error ? error.message : error}`,
		);
	}
}

function fail(file: string, message: string): never {
	throw new LocalBoardError(`${file}: ${message}`);
}

function asString(file: string, value: unknown, field: string): string {
	if (typeof value !== "string" || value === "") {
		fail(file, `${field} must be a non-empty string`);
	}
	return value;
}

function optString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function list(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/** Check a decoded board and put its fields in one order. */
export function validateBoard(raw: unknown, file = "board.toon"): LocalBoard {
	if (!raw || typeof raw !== "object") fail(file, "not a board");
	const r = raw as Record<string, unknown>;
	const team = (r.team ?? {}) as Record<string, unknown>;
	const nextNumber = Number(r.next_number);
	if (!Number.isInteger(nextNumber) || nextNumber < 1) {
		fail(file, "next_number must be a positive integer");
	}
	const statuses: LocalStatusDef[] = list(r.statuses).map((s) => {
		const type = s.type as LocalStatusDef["type"];
		if (!LOCAL_STATUS_TYPES.includes(type)) {
			fail(
				file,
				`status "${String(s.name)}" has type "${String(s.type)}"; use one of ${LOCAL_STATUS_TYPES.join(", ")}`,
			);
		}
		return {
			id: asString(file, s.id, "status id"),
			name: asString(file, s.name, "status name"),
			type,
		};
	});
	if (statuses.length === 0) fail(file, "the board has no statuses");
	const labels: LocalLabelDef[] = list(r.labels).map((l) =>
		compact({
			id: asString(file, l.id, "label id"),
			name: asString(file, l.name, "label name"),
			color: optString(l.color),
		}),
	);
	const cycle = r.current_cycle as Record<string, unknown> | undefined;
	return compact({
		version: 1 as const,
		team: {
			key: asString(file, team.key, "team.key"),
			name: asString(file, team.name, "team.name"),
		},
		next_number: nextNumber,
		statuses,
		labels,
		current_cycle:
			cycle && typeof cycle === "object"
				? compact({
						id: asString(file, cycle.id, "current_cycle.id"),
						name: asString(file, cycle.name, "current_cycle.name"),
						start_date: optString(cycle.start_date),
						end_date: optString(cycle.end_date),
					})
				: undefined,
	});
}

/** Check a decoded issue and put its fields in one order. */
export function validateIssue(raw: unknown, file = "issue"): LocalIssue {
	if (!raw || typeof raw !== "object") fail(file, "not an issue");
	const r = raw as Record<string, unknown>;
	const number = Number(r.number);
	if (!Number.isInteger(number) || number < 1) {
		fail(file, "number must be a positive integer");
	}
	const priority = Number(r.priority ?? 0);
	if (!Number.isInteger(priority) || priority < 0 || priority > 4) {
		fail(file, "priority must be 0-4");
	}
	const relations: LocalRelation[] = list(r.relations).map((rel) => {
		const type = rel.type as LocalRelation["type"];
		if (!LOCAL_RELATION_TYPES.includes(type)) {
			fail(file, `relation type "${String(rel.type)}" is unknown`);
		}
		return { type, issue: asString(file, rel.issue, "relation issue") };
	});
	const comments: LocalComment[] = list(r.comments).map((c) =>
		compact({
			id: asString(file, c.id, "comment id"),
			body: typeof c.body === "string" ? c.body : String(c.body ?? ""),
			user: optString(c.user),
			created_at: asString(file, c.created_at, "comment created_at"),
		}),
	);
	const estimate =
		r.estimate === undefined || r.estimate === null
			? undefined
			: Number(r.estimate);
	if (estimate !== undefined && Number.isNaN(estimate)) {
		fail(file, "estimate must be a number");
	}
	return compact({
		identifier: asString(file, r.identifier, "identifier"),
		number,
		title: asString(file, r.title, "title"),
		description: optString(r.description),
		state: asString(file, r.state, "state"),
		priority,
		labels: Array.isArray(r.labels) ? r.labels.map(String) : [],
		assignee: optString(r.assignee),
		estimate,
		parent: optString(r.parent),
		relations,
		comments,
		cycle: optString(r.cycle),
		creator: optString(r.creator),
		created_at: asString(file, r.created_at, "created_at"),
		updated_at: asString(file, r.updated_at, "updated_at"),
		started_at: optString(r.started_at),
		completed_at: optString(r.completed_at),
		canceled_at: optString(r.canceled_at),
	});
}

export async function boardExists(): Promise<boolean> {
	return (await readToon(boardPath())) !== undefined;
}

export async function readBoard(): Promise<LocalBoard> {
	const raw = await readToon(boardPath());
	if (raw === undefined) {
		throw new LocalBoardError(
			`No local board at ${boardPath()}. Run 'ttt init --source local' first.`,
		);
	}
	return validateBoard(raw, boardPath());
}

async function readIssueFile(
	identifier: string,
): Promise<LocalIssue | undefined> {
	const file = issuePath(identifier);
	const raw = await readToon(file);
	if (raw === undefined) return undefined;
	const issue = validateIssue(raw, file);
	if (issue.identifier !== identifier) {
		fail(file, `holds ${issue.identifier}; the file was renamed by hand`);
	}
	return issue;
}

/** Identifiers of every issue file, lowest number first. */
async function listIdentifiers(): Promise<string[]> {
	const files = await fs.readdir(issuesDir()).catch(() => [] as string[]);
	return files
		.filter((f) => f.endsWith(".toon"))
		.map((f) => f.slice(0, -".toon".length))
		.sort((a, b) => numberOf(a) - numberOf(b));
}

function numberOf(identifier: string): number {
	const match = /-(\d+)$/.exec(identifier);
	return match ? Number(match[1]) : 0;
}

export async function listIssues(): Promise<LocalIssue[]> {
	const issues: LocalIssue[] = [];
	for (const id of await listIdentifiers()) {
		const issue = await readIssueFile(id);
		if (issue) issues.push(issue);
	}
	return issues;
}

/**
 * Turn what a user typed (`mp-3`, `3`, `MP-3`) into the board's identifier
 * form. Does not check that the issue exists.
 */
export function normalizeIdentifier(board: LocalBoard, input: string): string {
	const trimmed = input.trim();
	if (/^\d+$/.test(trimmed)) return `${board.team.key}-${Number(trimmed)}`;
	return trimmed.toUpperCase();
}

export async function readIssue(
	identifier: string,
): Promise<LocalIssue | undefined> {
	const board = await readBoard();
	return readIssueFile(normalizeIdentifier(board, identifier));
}

/** What a transaction can do while it holds the board lock. */
export interface BoardTransaction {
	board: LocalBoard;
	get(identifier: string): Promise<LocalIssue | undefined>;
	/** Like get, but throws when the issue does not exist */
	require(identifier: string): Promise<LocalIssue>;
	/** Stage an issue to be written when the transaction ends */
	put(issue: LocalIssue): void;
	/** Allocate the next number and stage the new issue */
	create(
		fields: Omit<
			LocalIssue,
			"identifier" | "number" | "created_at" | "updated_at"
		>,
	): Promise<LocalIssue>;
	/** Every issue on the board, staged changes included */
	all(): Promise<LocalIssue[]>;
}

function lockError(holder: string): Error {
	return new LocalBoardError(
		`The local board is locked by ${holder} (${path.join(localBoardDir(), ".lock")}). Retry in a moment.`,
	);
}

/**
 * Lock the board, run `fn`, then write what it staged: issues first, the
 * board (with its next number) last. A crash in between leaves a written
 * issue whose number the next run skips, never a number handed out twice.
 */
export async function transact<T>(
	fn: (tx: BoardTransaction) => Promise<T>,
): Promise<T> {
	await fs.mkdir(issuesDir(), { recursive: true });
	return withFileLock(
		path.join(localBoardDir(), ".lock"),
		lockError,
		async () => {
			const board = await readBoard();
			const before = JSON.stringify(board);
			const staged = new Map<string, LocalIssue>();
			const created = new Set<string>();

			const get = async (identifier: string) => {
				const id = normalizeIdentifier(board, identifier);
				return staged.get(id) ?? (await readIssueFile(id));
			};
			const tx: BoardTransaction = {
				board,
				get,
				async require(identifier) {
					const issue = await get(identifier);
					if (!issue) {
						throw new LocalBoardError(
							`Issue ${normalizeIdentifier(board, identifier)} is not on the local board.`,
						);
					}
					return issue;
				},
				put(issue) {
					staged.set(issue.identifier, issue);
				},
				async create(fields) {
					// The counter is the floor; an issue file above it (written
					// before a crash) pushes it up, so no number is reused
					const ids = await listIdentifiers();
					const highest = Math.max(0, ...ids.map(numberOf));
					let number = Math.max(board.next_number, highest + 1);
					while (staged.has(`${board.team.key}-${number}`)) number++;
					const now = new Date().toISOString();
					const issue = validateIssue({
						...fields,
						identifier: `${board.team.key}-${number}`,
						number,
						created_at: now,
						updated_at: now,
					});
					board.next_number = number + 1;
					staged.set(issue.identifier, issue);
					created.add(issue.identifier);
					return issue;
				},
				async all() {
					const byId = new Map<string, LocalIssue>();
					for (const issue of await listIssues()) {
						byId.set(issue.identifier, issue);
					}
					for (const [id, issue] of staged) byId.set(id, issue);
					return [...byId.values()].sort((a, b) => a.number - b.number);
				},
			};

			const result = await fn(tx);

			for (const [id, issue] of staged) {
				const file = issuePath(id);
				if (created.has(id)) {
					// A file at a fresh number means another writer bypassed the
					// lock; refuse rather than overwrite its issue
					await writeNew(file, validateIssue(issue, file)).catch((error) => {
						if ((error as NodeJS.ErrnoException).code === "EEXIST") {
							throw new LocalBoardError(
								`${file} appeared while the board was locked; nothing overwritten. Retry.`,
							);
						}
						throw error;
					});
				} else {
					await writeAtomic(file, validateIssue(issue, file));
				}
			}
			if (JSON.stringify(board) !== before) {
				await writeAtomic(boardPath(), validateBoard(board));
			}
			return result;
		},
	);
}

/**
 * Write a new board, or keep the one already there. Returns the board in
 * effect and whether this call created it.
 */
export async function initBoard(
	board: LocalBoard,
): Promise<{ board: LocalBoard; created: boolean }> {
	await fs.mkdir(issuesDir(), { recursive: true });
	return withFileLock(
		path.join(localBoardDir(), ".lock"),
		lockError,
		async () => {
			const existing = await readToon(boardPath());
			if (existing !== undefined) {
				return { board: validateBoard(existing, boardPath()), created: false };
			}
			const next = validateBoard(board);
			await writeAtomic(boardPath(), next);
			return { board: next, created: true };
		},
	);
}
