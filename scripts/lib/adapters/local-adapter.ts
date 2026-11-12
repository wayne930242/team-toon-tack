/**
 * Local adapter: the task source is the TOON board under `.ttt/local/`.
 * Issue display IDs double as source IDs (`MP-3` is both), statuses and
 * labels come from the board, users from config.toon.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import { decode } from "@toon-format/toon";
import { type Config, getPaths, type LocalConfig } from "../../utils.js";
import {
	boardExists,
	listIssues,
	readBoard,
	readIssue,
	transact,
} from "../local/store.js";
import type {
	LocalBoard,
	LocalIssue,
	LocalRelationType,
	LocalStatusDef,
} from "../local/types.js";
import type {
	CreateIssueOptions,
	GetIssuesOptions,
	InitData,
	SourceCycle,
	SourceIssue,
	SourceLabel,
	SourceRelationType,
	SourceStatus,
	SourceTeam,
	SourceUser,
	TaskSourceAdapter,
	UpdateIssueFields,
} from "./types.js";

type Result = { success: boolean; error?: string };

const OPPOSITE: Record<LocalRelationType, LocalRelationType> = {
	blocks: "blocked_by",
	blocked_by: "blocks",
	related: "related",
};

function errorResult(error: unknown): Result {
	return {
		success: false,
		error: error instanceof Error ? error.message : String(error),
	};
}

/** Linear-style branch name: `mp-3-fix-login-flow`. */
function branchName(issue: LocalIssue): string {
	const slug = issue.title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40)
		.replace(/-+$/, "");
	return slug
		? `${issue.identifier.toLowerCase()}-${slug}`
		: issue.identifier.toLowerCase();
}

/** Stamp the time fields Linear keeps for each kind of state. */
function enterState(
	issue: LocalIssue,
	status: LocalStatusDef,
	now: string,
): void {
	issue.state = status.name;
	issue.completed_at = status.type === "completed" ? now : undefined;
	issue.canceled_at = status.type === "canceled" ? now : undefined;
	if (status.type === "started" && !issue.started_at) issue.started_at = now;
}

export class LocalAdapter implements TaskSourceAdapter {
	readonly type = "local" as const;
	readonly supportsEstimate = true;
	private actor?: { id?: string; name: string };

	constructor(private readonly config: Config) {}

	/** Who is writing: the first current_user, else TTT_ACTOR or the OS user. */
	private async getActor(): Promise<{ id?: string; name: string }> {
		if (this.actor) return this.actor;
		let local: Partial<LocalConfig> = {};
		try {
			local = decode(await fs.readFile(getPaths().localPath, "utf8"), {
				strict: false,
			}) as Partial<LocalConfig>;
		} catch {
			// No local.toon: fall back below
		}
		const key = Array.isArray(local.current_user)
			? local.current_user[0]
			: local.current_user;
		const user = key ? this.config.users?.[key] : undefined;
		this.actor = user
			? { id: user.id, name: user.displayName }
			: { name: process.env.TTT_ACTOR || os.userInfo().username };
		return this.actor;
	}

	private userById(id: string | undefined) {
		if (!id) return undefined;
		return Object.values(this.config.users ?? {}).find((u) => u.id === id);
	}

	private toSourceIssue(
		board: LocalBoard,
		issue: LocalIssue,
		detail: boolean,
	): SourceIssue {
		const status = board.statuses.find((s) => s.name === issue.state);
		return {
			id: issue.identifier,
			sourceId: issue.identifier,
			title: issue.title,
			description: issue.description,
			status: issue.state,
			statusId: status?.id ?? "",
			assigneeId: issue.assignee,
			assigneeEmail: this.userById(issue.assignee)?.email || undefined,
			priority: issue.priority,
			labels: [...issue.labels],
			parentIssueId: issue.parent,
			branchName: branchName(issue),
			estimate: issue.estimate,
			relations:
				issue.relations.length > 0
					? issue.relations.map((r) => ({ type: r.type, issueId: r.issue }))
					: undefined,
			comments:
				detail && issue.comments.length > 0
					? issue.comments.map((c) => ({
							id: c.id,
							body: c.body,
							createdAt: c.created_at,
							user: c.user,
						}))
					: undefined,
		};
	}

	private checkTeam(board: LocalBoard, teamId: string): void {
		if (teamId !== board.team.key) {
			throw new Error(
				`Team "${teamId}" is not this board's team (${board.team.key}).`,
			);
		}
	}

	private statusById(board: LocalBoard, statusId: string): LocalStatusDef {
		const status =
			board.statuses.find((s) => s.id === statusId) ??
			board.statuses.find(
				(s) => s.name.toLowerCase() === statusId.toLowerCase(),
			);
		if (!status) {
			throw new Error(
				`Status "${statusId}" is not on the board. Available: ${board.statuses.map((s) => s.name).join(", ")}`,
			);
		}
		return status;
	}

	private labelNames(board: LocalBoard, labelIds: string[]): string[] {
		return labelIds.map((id) => {
			const label =
				board.labels.find((l) => l.id === id) ??
				board.labels.find((l) => l.name.toLowerCase() === id.toLowerCase());
			if (!label) {
				throw new Error(
					`Label "${id}" is not on the board. Available: ${board.labels.map((l) => l.name).join(", ") || "(none)"}`,
				);
			}
			return label.name;
		});
	}

	private checkUser(userId: string): void {
		if (!this.userById(userId)) {
			throw new Error(`User "${userId}" is not in config.toon users.`);
		}
	}

	/** Refuse a parent that would make the issue its own ancestor. */
	private async checkParent(
		get: (id: string) => Promise<LocalIssue | undefined>,
		child: string | undefined,
		parent: string,
	): Promise<void> {
		let current: string | undefined = parent;
		const seen = new Set<string>();
		while (current) {
			if (current === child) {
				throw new Error(`${parent} cannot be the parent of ${child}: a cycle.`);
			}
			if (seen.has(current)) break;
			seen.add(current);
			const issue = await get(current);
			if (!issue) {
				if (current === parent) {
					throw new Error(`Parent issue ${parent} is not on the board.`);
				}
				break;
			}
			current = issue.parent;
		}
	}

	async validateConnection(): Promise<boolean> {
		return boardExists();
	}

	async getTeams(): Promise<SourceTeam[]> {
		const board = await readBoard();
		return [{ id: board.team.key, name: board.team.name }];
	}

	async getUsers(_teamId: string): Promise<SourceUser[]> {
		return Object.values(this.config.users ?? {}).map((u) => ({
			id: u.id,
			email: u.email || undefined,
			displayName: u.displayName,
		}));
	}

	async getStatuses(teamId: string): Promise<SourceStatus[]> {
		const board = await readBoard();
		this.checkTeam(board, teamId);
		return board.statuses.map((s, position) => ({
			id: s.id,
			name: s.name,
			type: s.type,
			position,
		}));
	}

	async getLabels(teamId: string): Promise<SourceLabel[]> {
		const board = await readBoard();
		this.checkTeam(board, teamId);
		return board.labels.map((l) => ({ ...l }));
	}

	async getCurrentCycle(teamId: string): Promise<SourceCycle | null> {
		const board = await readBoard();
		this.checkTeam(board, teamId);
		const cycle = board.current_cycle;
		return cycle
			? {
					id: cycle.id,
					name: cycle.name,
					startDate: cycle.start_date,
					endDate: cycle.end_date,
				}
			: null;
	}

	async getIssues(options: GetIssuesOptions): Promise<SourceIssue[]> {
		const board = await readBoard();
		this.checkTeam(board, options.teamId);
		const statuses = options.statusNames?.length
			? new Set(options.statusNames)
			: undefined;
		const labels = options.labelNames?.length
			? new Set(options.labelNames)
			: undefined;
		const assignees = options.assigneeEmails?.length
			? new Set(options.assigneeEmails.map((e) => e.toLowerCase()))
			: undefined;
		const excluded = new Set(options.excludeLabels ?? []);
		const creatorEmails = options.creator?.emails?.map((e) => e.toLowerCase());
		const creatorNeedle = options.creator?.match?.toLowerCase();

		const matches = (await listIssues()).filter((issue) => {
			if (options.cycleId && issue.cycle !== options.cycleId) return false;
			if (statuses && !statuses.has(issue.state)) return false;
			if (labels && !issue.labels.some((l) => labels.has(l))) return false;
			if (issue.labels.some((l) => excluded.has(l))) return false;
			if (assignees) {
				const email = this.userById(issue.assignee)?.email?.toLowerCase();
				if (!email || !assignees.has(email)) return false;
			}
			if (creatorEmails?.length || creatorNeedle) {
				const creator = this.userById(issue.creator);
				const email = creator?.email?.toLowerCase() ?? "";
				if (creatorEmails?.length) {
					if (!creatorEmails.includes(email)) return false;
				} else if (
					creatorNeedle &&
					![creator?.displayName ?? "", email, issue.creator ?? ""].some((v) =>
						v.toLowerCase().includes(creatorNeedle),
					)
				) {
					return false;
				}
			}
			return true;
		});
		return matches
			.slice(0, options.limit ?? matches.length)
			.map((issue) => this.toSourceIssue(board, issue, false));
	}

	async getIssue(issueId: string): Promise<SourceIssue | null> {
		const board = await readBoard();
		const issue = await readIssue(issueId);
		return issue ? this.toSourceIssue(board, issue, true) : null;
	}

	async searchIssue(identifier: string): Promise<SourceIssue | null> {
		return this.getIssue(identifier);
	}

	async updateIssueStatus(sourceId: string, statusId: string): Promise<Result> {
		try {
			await transact(async (tx) => {
				const issue = await tx.require(sourceId);
				const now = new Date().toISOString();
				enterState(issue, this.statusById(tx.board, statusId), now);
				issue.updated_at = now;
				tx.put(issue);
			});
			return { success: true };
		} catch (error) {
			return errorResult(error);
		}
	}

	async addComment(sourceId: string, body: string): Promise<Result> {
		try {
			const actor = await this.getActor();
			await transact(async (tx) => {
				const issue = await tx.require(sourceId);
				const now = new Date().toISOString();
				issue.comments.push({
					id: randomUUID(),
					body,
					user: actor.name,
					created_at: now,
				});
				issue.updated_at = now;
				tx.put(issue);
			});
			return { success: true };
		} catch (error) {
			return errorResult(error);
		}
	}

	/** The status a new issue starts in when none is given: Todo, as configured. */
	private defaultStatus(board: LocalBoard): LocalStatusDef {
		const todo = this.config.status_transitions?.todo;
		const name = Array.isArray(todo) ? todo[0] : todo;
		return (
			board.statuses.find((s) => s.name === name) ??
			board.statuses.find((s) => s.type === "unstarted") ??
			board.statuses[0]
		);
	}

	async createIssue(
		options: CreateIssueOptions,
	): Promise<{ success: boolean; issue?: SourceIssue; error?: string }> {
		try {
			const actor = await this.getActor();
			if (options.assigneeId) this.checkUser(options.assigneeId);
			const created = await transact(async (tx) => {
				this.checkTeam(tx.board, options.teamId);
				const status = options.statusId
					? this.statusById(tx.board, options.statusId)
					: this.defaultStatus(tx.board);
				if (options.parentIssueId) {
					await this.checkParent(tx.get, undefined, options.parentIssueId);
				}
				const issue = await tx.create({
					title: options.title,
					description: options.description,
					state: status.name,
					priority: options.priority ?? 0,
					labels: this.labelNames(tx.board, options.labelIds ?? []),
					assignee: options.assigneeId,
					estimate: options.estimate,
					parent: options.parentIssueId
						? (await tx.require(options.parentIssueId)).identifier
						: undefined,
					relations: [],
					comments: [],
					cycle: options.cycleId,
					creator: actor.id,
				});
				enterState(issue, status, issue.created_at);
				return { board: tx.board, issue };
			});
			return {
				success: true,
				issue: this.toSourceIssue(created.board, created.issue, true),
			};
		} catch (error) {
			return errorResult(error);
		}
	}

	async updateIssue(
		sourceId: string,
		fields: UpdateIssueFields,
	): Promise<Result> {
		try {
			if (fields.assigneeId) this.checkUser(fields.assigneeId);
			await transact(async (tx) => {
				const issue = await tx.require(sourceId);
				const now = new Date().toISOString();
				if (fields.title !== undefined) issue.title = fields.title;
				if (fields.description !== undefined) {
					issue.description = fields.description || undefined;
				}
				if (fields.assigneeId !== undefined) {
					issue.assignee = fields.assigneeId || undefined;
				}
				if (fields.priority !== undefined) issue.priority = fields.priority;
				if (fields.labelIds !== undefined) {
					issue.labels = this.labelNames(tx.board, fields.labelIds);
				}
				if (fields.estimate !== undefined) issue.estimate = fields.estimate;
				if (fields.statusId !== undefined) {
					enterState(issue, this.statusById(tx.board, fields.statusId), now);
				}
				if (fields.parentIssueId === null) {
					issue.parent = undefined;
				} else if (fields.parentIssueId !== undefined) {
					await this.checkParent(
						tx.get,
						issue.identifier,
						fields.parentIssueId,
					);
					issue.parent = (await tx.require(fields.parentIssueId)).identifier;
				}
				issue.updated_at = now;
				tx.put(issue);
			});
			return { success: true };
		} catch (error) {
			return errorResult(error);
		}
	}

	async addRelation(
		sourceId: string,
		type: SourceRelationType,
		relatedSourceId: string,
	): Promise<Result> {
		try {
			await transact(async (tx) => {
				const issue = await tx.require(sourceId);
				const other = await tx.require(relatedSourceId);
				if (issue.identifier === other.identifier) {
					throw new Error(`${issue.identifier} cannot relate to itself.`);
				}
				const now = new Date().toISOString();
				const link = (
					from: LocalIssue,
					to: LocalIssue,
					t: LocalRelationType,
				) => {
					if (
						!from.relations.some(
							(r) => r.type === t && r.issue === to.identifier,
						)
					) {
						from.relations.push({ type: t, issue: to.identifier });
						from.updated_at = now;
					}
					tx.put(from);
				};
				link(issue, other, type);
				link(other, issue, OPPOSITE[type]);
			});
			return { success: true };
		} catch (error) {
			return errorResult(error);
		}
	}

	async cancelIssue(sourceId: string): Promise<Result> {
		try {
			const board = await readBoard();
			const canceled = board.statuses.find((s) => s.type === "canceled");
			if (!canceled) {
				return {
					success: false,
					error: "The board has no status of type canceled.",
				};
			}
			return this.updateIssueStatus(sourceId, canceled.id);
		} catch (error) {
			return errorResult(error);
		}
	}

	async getInitData(_teamId?: string): Promise<InitData> {
		const board = await readBoard();
		return {
			teams: await this.getTeams(),
			users: await this.getUsers(board.team.key),
			statuses: await this.getStatuses(board.team.key),
			labels: await this.getLabels(board.team.key),
			currentCycle: (await this.getCurrentCycle(board.team.key)) ?? undefined,
		};
	}
}
