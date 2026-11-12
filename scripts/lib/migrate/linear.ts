/**
 * Move the local board into a Linear team.
 *
 * Every object created in Linear (label, issue, comment, relation) gets its
 * UUID from us, written to the mapping file before the create is sent.
 * Linear refuses a second create with the same id, so a rerun after any
 * failure, even a crash between Linear storing an issue and us recording it,
 * looks the id up instead of creating a duplicate. The config switches to
 * Linear only after every step succeeded.
 *
 *   .ttt/local/migration-linear.toon   mapping and progress
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { IssueRelationType, type LinearClient } from "@linear/sdk";
import { decode, encode } from "@toon-format/toon";
import {
	type Config,
	type CycleData,
	type LocalConfig,
	type StatusTransitions,
	withRetry,
} from "../../utils.js";
import { buildConfig, buildLocalConfig } from "../config-builder.js";
import { listIssues, localBoardDir, readBoard } from "../local/store.js";
import type { LocalBoard, LocalIssue, LocalStatusDef } from "../local/types.js";

export class MigrateError extends Error {}

interface Progress {
	/** Our UUID for the object in Linear */
	id: string;
	/** A create was sent; its outcome may be unknown */
	attempted: boolean;
	created: boolean;
}

interface LabelEntry extends Progress {
	name: string;
	/** True when Linear already had this label (nothing to create) */
	existing: boolean;
}

interface CommentEntry extends Progress {
	local: string;
}

interface IssueEntry extends Progress {
	local: string;
	/** Linear identifier, known once created */
	identifier?: string;
	parent_set: boolean;
	comments: CommentEntry[];
}

interface RelationEntry extends Progress {
	from: string;
	to: string;
	type: "blocks" | "related";
}

export interface MigrationFile {
	target: { team_id: string; team_name: string; team_key?: string };
	started_at: string;
	finished_at?: string;
	labels: LabelEntry[];
	issues: IssueEntry[];
	relations: RelationEntry[];
}

export function mappingPath(): string {
	return path.join(localBoardDir(), "migration-linear.toon");
}

async function readMapping(): Promise<MigrationFile | undefined> {
	try {
		return decode(await fs.readFile(mappingPath(), "utf8"), {
			strict: false,
		}) as unknown as MigrationFile;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw new MigrateError(
			`${mappingPath()}: ${error instanceof Error ? error.message : error}`,
		);
	}
}

async function writeMapping(mapping: MigrationFile): Promise<void> {
	const file = mappingPath();
	const temp = `${file}.${process.pid}.tmp`;
	await fs.writeFile(temp, encode(mapping), "utf8");
	await fs.rename(temp, file);
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** True when Linear has the entity, false on its "not found" answer. */
async function exists(lookup: () => Promise<unknown>): Promise<boolean> {
	try {
		await withRetry(lookup);
		return true;
	} catch (error) {
		if (/not found/i.test(message(error))) return false;
		throw error;
	}
}

/**
 * Create once: an earlier attempt that may have reached Linear is looked up
 * first; a failed create is looked up before it counts as failed, since the
 * answer may be what got lost.
 */
async function createOnce(
	entry: Progress,
	lookup: () => Promise<unknown>,
	create: () => Promise<{ success: boolean }>,
	save: () => Promise<void>,
	what: string,
): Promise<void> {
	if (entry.created) return;
	if (entry.attempted && (await exists(lookup))) {
		entry.created = true;
		await save();
		return;
	}
	entry.attempted = true;
	await save();
	try {
		const payload = await create();
		if (!payload.success) throw new Error("Linear answered success=false");
	} catch (error) {
		if (!(await exists(lookup))) {
			throw new MigrateError(`Creating ${what} failed: ${message(error)}`);
		}
	}
	entry.created = true;
	await save();
}

interface LinearTarget {
	team: { id: string; name: string; key: string; icon?: string };
	states: { id: string; name: string; type: string }[];
	labels: { id: string; name: string; color?: string }[];
	users: {
		id: string;
		email?: string;
		name?: string;
		displayName?: string;
	}[];
}

async function loadTarget(
	client: LinearClient,
	teamArg: string | undefined,
	knownTeamId: string | undefined,
): Promise<LinearTarget> {
	const teams = (await withRetry(() => client.teams({ first: 250 }))).nodes;
	const wanted = teamArg?.toLowerCase();
	const matches = teams.filter((t) =>
		wanted
			? [t.id, t.key, t.name].some((v) => v?.toLowerCase() === wanted)
			: knownTeamId
				? t.id === knownTeamId
				: true,
	);
	if (matches.length !== 1) {
		const list = teams.map((t) => `${t.key} (${t.name})`).join(", ");
		throw new MigrateError(
			teamArg
				? `No single Linear team matches "${teamArg}". Teams: ${list}`
				: `Pick the Linear team with --team <key>. Teams: ${list}`,
		);
	}
	const team = matches[0];
	if (knownTeamId && team.id !== knownTeamId) {
		throw new MigrateError(
			`An earlier run migrated into team ${knownTeamId} (${mappingPath()}); continue there or remove the mapping file.`,
		);
	}
	const [states, labels, users] = await Promise.all([
		withRetry(() =>
			client.workflowStates({ filter: { team: { id: { eq: team.id } } } }),
		),
		withRetry(() =>
			client.issueLabels({
				filter: {
					or: [{ team: { id: { eq: team.id } } }, { team: { null: true } }],
				},
				first: 250,
			}),
		),
		withRetry(() => client.users({ first: 250 })),
	]);
	return {
		team: {
			id: team.id,
			name: team.name,
			key: team.key,
			icon: team.icon ?? undefined,
		},
		states: states.nodes.map((s) => ({ id: s.id, name: s.name, type: s.type })),
		labels: labels.nodes.map((l) => ({
			id: l.id,
			name: l.name,
			color: l.color ?? undefined,
		})),
		users: users.nodes.map((u) => ({
			id: u.id,
			email: u.email ?? undefined,
			name: u.name ?? undefined,
			displayName: u.displayName ?? undefined,
		})),
	};
}

/** Local status name → Linear state: same name, else the first of its type. */
function mapStates(
	statuses: LocalStatusDef[],
	target: LinearTarget,
): Map<string, { id: string; name: string }> {
	const map = new Map<string, { id: string; name: string }>();
	const missing: string[] = [];
	for (const status of statuses) {
		const state =
			target.states.find(
				(s) => s.name.toLowerCase() === status.name.toLowerCase(),
			) ?? target.states.find((s) => s.type === status.type);
		if (state) map.set(status.name, state);
		else missing.push(`${status.name} (${status.type})`);
	}
	if (missing.length > 0) {
		throw new MigrateError(
			`Linear team ${target.team.key} has no state for ${missing.join(", ")}. Add one in Linear, or rename the local status.`,
		);
	}
	return map;
}

/** Local user id → Linear user: same email, else same name. */
function mapUsers(
	config: Config,
	target: LinearTarget,
): { map: Map<string, string>; unmatched: string[] } {
	const map = new Map<string, string>();
	const unmatched: string[] = [];
	for (const [key, user] of Object.entries(config.users ?? {})) {
		const email = user.email?.toLowerCase();
		const name = user.displayName.toLowerCase();
		const found =
			(email && !email.endsWith("@local")
				? target.users.find((u) => u.email?.toLowerCase() === email)
				: undefined) ??
			target.users.find(
				(u) =>
					u.name?.toLowerCase() === name ||
					u.displayName?.toLowerCase() === name,
			);
		if (found) map.set(user.id, found.id);
		else unmatched.push(`${user.displayName} (${key})`);
	}
	return { map, unmatched };
}

/** Blocks and related relations, one per pair; blocked_by is the other side. */
function collectRelations(
	issues: LocalIssue[],
): { from: string; to: string; type: "blocks" | "related" }[] {
	const seen = new Set<string>();
	const relations: { from: string; to: string; type: "blocks" | "related" }[] =
		[];
	const known = new Set(issues.map((i) => i.identifier));
	for (const issue of issues) {
		for (const rel of issue.relations) {
			if (!known.has(rel.issue)) continue;
			let from = issue.identifier;
			let to = rel.issue;
			let type: "blocks" | "related" = "blocks";
			if (rel.type === "blocked_by") {
				[from, to] = [rel.issue, issue.identifier];
			} else if (rel.type === "related") {
				type = "related";
				[from, to] = [issue.identifier, rel.issue].sort();
			}
			const key = `${type}:${from}:${to}`;
			if (seen.has(key)) continue;
			seen.add(key);
			relations.push({ from, to, type });
		}
	}
	return relations;
}

function commentBody(issue: LocalIssue, comment: LocalIssue["comments"][0]) {
	const who = comment.user ? `${comment.user}, ` : "";
	return `*${who}${comment.created_at.slice(0, 10)}, from local ${issue.identifier}:*\n\n${comment.body}`;
}

/** Add entries for whatever the mapping does not cover yet. */
function extendMapping(
	mapping: MigrationFile,
	issues: LocalIssue[],
	labelNames: string[],
	target: LinearTarget,
): void {
	for (const name of labelNames) {
		if (mapping.labels.some((l) => l.name === name)) continue;
		const existing = target.labels.find(
			(l) => l.name.toLowerCase() === name.toLowerCase(),
		);
		mapping.labels.push({
			name,
			id: existing?.id ?? randomUUID(),
			existing: Boolean(existing),
			attempted: false,
			created: Boolean(existing),
		});
	}
	for (const issue of issues) {
		let entry = mapping.issues.find((e) => e.local === issue.identifier);
		if (!entry) {
			entry = {
				local: issue.identifier,
				id: randomUUID(),
				attempted: false,
				created: false,
				parent_set: false,
				comments: [],
			};
			mapping.issues.push(entry);
		}
		for (const comment of issue.comments) {
			if (!entry.comments.some((c) => c.local === comment.id)) {
				entry.comments.push({
					local: comment.id,
					id: randomUUID(),
					attempted: false,
					created: false,
				});
			}
		}
	}
	for (const rel of collectRelations(issues)) {
		if (
			mapping.relations.some(
				(r) => r.from === rel.from && r.to === rel.to && r.type === rel.type,
			)
		) {
			continue;
		}
		mapping.relations.push({
			...rel,
			id: randomUUID(),
			attempted: false,
			created: false,
		});
	}
}

export interface MigrateOptions {
	client: LinearClient;
	config: Config;
	localConfig: LocalConfig;
	/** Linear team key, name, or id */
	team?: string;
	dryRun: boolean;
	log: (line: string) => void;
	configPath: string;
	localPath: string;
	cyclePath: string;
}

export async function migrateToLinear(options: MigrateOptions): Promise<void> {
	const { client, config, log } = options;
	const board: LocalBoard = await readBoard();
	const issues = await listIssues();
	const previous = await readMapping();
	const target = await loadTarget(
		client,
		options.team,
		previous?.target.team_id,
	);
	const states = mapStates(board.statuses, target);
	const users = mapUsers(config, target);
	const labelNames = [...new Set(issues.flatMap((i) => i.labels))];

	const mapping: MigrationFile = previous ?? {
		target: {
			team_id: target.team.id,
			team_name: target.team.name,
			team_key: target.team.key,
		},
		started_at: new Date().toISOString(),
		labels: [],
		issues: [],
		relations: [],
	};
	extendMapping(mapping, issues, labelNames, target);
	const entryOf = (local: string) =>
		mapping.issues.find((e) => e.local === local) as IssueEntry;

	// The plan, printed for a dry run and a real one alike
	log(
		`Local board ${board.team.key} (${issues.length} issues) → Linear team ${target.team.key} (${target.team.name})`,
	);
	log(
		`States: ${board.statuses.map((s) => `${s.name} → ${states.get(s.name)?.name}`).join(", ")}`,
	);
	if (labelNames.length > 0) {
		log(
			`Labels: ${mapping.labels
				.filter((l) => labelNames.includes(l.name))
				.map(
					(l) =>
						`${l.name} (${l.existing ? "exists" : l.created ? "created" : "create"})`,
				)
				.join(", ")}`,
		);
	}
	if (users.unmatched.length > 0) {
		log(
			`No Linear user for ${users.unmatched.join(", ")}: their issues go in unassigned.`,
		);
	}
	if (issues.some((i) => i.cycle)) {
		log("Cycles are not carried over: Linear cycles are dated per team.");
	}
	const describeAssignee = (id: string) => {
		const linearId = users.map.get(id);
		const user = target.users.find((u) => u.id === linearId);
		return user
			? `${id} → ${user.name ?? user.displayName ?? user.email}`
			: `${id} → unassigned`;
	};
	for (const issue of issues) {
		const entry = entryOf(issue.identifier);
		const parts = [
			states.get(issue.state)?.name,
			issue.labels.length > 0 ? `labels ${issue.labels.join(", ")}` : "",
			issue.assignee ? `assignee ${describeAssignee(issue.assignee)}` : "",
			issue.parent ? `parent ${issue.parent}` : "",
			issue.comments.length > 0 ? `${issue.comments.length} comment(s)` : "",
		].filter(Boolean);
		const done = entry.created
			? `already ${entry.identifier ?? "created"}`
			: options.dryRun
				? "would create"
				: "create";
		log(
			`  ${issue.identifier} "${issue.title}" → ${done} (${parts.join("; ")})`,
		);
	}
	const relations = mapping.relations.filter((r) => !r.created);
	if (relations.length > 0) {
		log(
			`Relations: ${relations.map((r) => `${r.from} ${r.type} ${r.to}`).join(", ")}`,
		);
	}

	if (options.dryRun) {
		log("\nDry run: nothing was written to Linear or to .ttt.");
		return;
	}

	const save = () => writeMapping(mapping);
	await save();

	for (const label of mapping.labels) {
		if (!labelNames.includes(label.name)) continue;
		const color = board.labels.find((l) => l.name === label.name)?.color;
		await createOnce(
			label,
			() => client.issueLabel(label.id),
			() =>
				client.createIssueLabel({
					id: label.id,
					name: label.name,
					teamId: target.team.id,
					...(color ? { color } : {}),
				}),
			save,
			`label ${label.name}`,
		);
	}
	const labelId = (name: string) =>
		mapping.labels.find((l) => l.name === name)?.id as string;

	for (const issue of issues) {
		const entry = entryOf(issue.identifier);
		await createOnce(
			entry,
			() => client.issue(entry.id),
			() =>
				client.createIssue({
					id: entry.id,
					teamId: target.team.id,
					title: issue.title,
					description: issue.description,
					priority: issue.priority,
					stateId: states.get(issue.state)?.id,
					labelIds: issue.labels.map(labelId),
					assigneeId: issue.assignee
						? users.map.get(issue.assignee)
						: undefined,
					estimate: issue.estimate,
					createdAt: new Date(issue.created_at),
				}),
			save,
			`${issue.identifier}`,
		);
		if (!entry.identifier) {
			entry.identifier = (
				await withRetry(() => client.issue(entry.id))
			).identifier;
			await save();
		}
		log(`✓ ${issue.identifier} → ${entry.identifier}`);
	}

	for (const issue of issues) {
		const entry = entryOf(issue.identifier);
		if (issue.parent && !entry.parent_set) {
			const parent = entryOf(issue.parent);
			if (parent) {
				const payload = await withRetry(() =>
					client.updateIssue(entry.id, { parentId: parent.id }),
				);
				if (!payload.success) {
					throw new MigrateError(
						`Setting the parent of ${issue.identifier} failed.`,
					);
				}
			}
			entry.parent_set = true;
			await save();
		}
		for (const comment of issue.comments) {
			const c = entry.comments.find((e) => e.local === comment.id);
			if (!c) continue;
			await createOnce(
				c,
				() => client.comment({ id: c.id }),
				() =>
					client.createComment({
						id: c.id,
						issueId: entry.id,
						body: commentBody(issue, comment),
						createdAt: new Date(comment.created_at),
					}),
				save,
				`a comment on ${issue.identifier}`,
			);
		}
	}

	for (const rel of mapping.relations) {
		const from = entryOf(rel.from);
		const to = entryOf(rel.to);
		if (!from || !to) continue;
		await createOnce(
			rel,
			() => client.issueRelation(rel.id),
			() =>
				client.createIssueRelation({
					id: rel.id,
					issueId: from.id,
					relatedIssueId: to.id,
					type:
						rel.type === "blocks"
							? IssueRelationType.Blocks
							: IssueRelationType.Related,
				}),
			save,
			`relation ${rel.from} ${rel.type} ${rel.to}`,
		);
	}

	// Issues added to the board while this ran are not migrated yet
	const now = await listIssues();
	const late = now.filter(
		(i) => !mapping.issues.some((e) => e.local === i.identifier && e.created),
	);
	if (late.length > 0) {
		throw new MigrateError(
			`${late.map((i) => i.identifier).join(", ")} appeared on the board during the run; rerun to migrate them.`,
		);
	}

	await switchToLinear(options, target, states, users.map, mapping, board);
	mapping.finished_at = new Date().toISOString();
	await save();
}

async function switchToLinear(
	options: MigrateOptions,
	target: LinearTarget,
	states: Map<string, { id: string; name: string }>,
	userMap: Map<string, string>,
	mapping: MigrationFile,
	board: LocalBoard,
): Promise<void> {
	const { config, localConfig } = options;
	const labels = await withRetry(() =>
		options.client.issueLabels({
			filter: {
				or: [
					{ team: { id: { eq: target.team.id } } },
					{ team: { null: true } },
				],
			},
			first: 250,
		}),
	);
	const local = config.status_transitions;
	const mapName = (name: string | undefined) =>
		name ? (states.get(name)?.name ?? name) : undefined;
	const transitions: StatusTransitions = {
		todo: Array.isArray(local?.todo)
			? local.todo.map((n) => mapName(n) as string)
			: (mapName(local?.todo) ?? "Todo"),
		in_progress: mapName(local?.in_progress) ?? "In Progress",
		done: mapName(local?.done) ?? "Done",
	};
	if (local?.testing) transitions.testing = mapName(local.testing);
	if (local?.blocked) transitions.blocked = mapName(local.blocked);

	const linearConfig: Config = {
		source: { type: "linear" },
		...buildConfig(
			[target.team],
			target.users,
			labels.nodes.map((l) => ({ id: l.id, name: l.name, color: l.color })),
			target.states,
			transitions,
		),
	};
	const teamKey = Object.keys(linearConfig.teams)[0];
	const currentKeys = (
		Array.isArray(localConfig.current_user)
			? localConfig.current_user
			: [localConfig.current_user]
	)
		.map((key) => config.users[key]?.id)
		.map((id) => (id ? userMap.get(id) : undefined))
		.map(
			(linearId) =>
				Object.entries(linearConfig.users).find(
					([, u]) => u.id === linearId,
				)?.[0],
		)
		.filter((key): key is string => Boolean(key));
	const nextLocal = buildLocalConfig(
		currentKeys.length === 1 ? currentKeys[0] : currentKeys,
		teamKey,
		undefined,
		undefined,
		localConfig.completion_mode,
		localConfig.labels,
		localConfig.exclude_labels,
		"remote",
		localConfig.linear_api_key_env,
	);
	await fs.writeFile(options.configPath, encode(stripUndefined(linearConfig)));
	await fs.writeFile(options.localPath, encode(stripUndefined(nextLocal)));

	// cycle.toon: same tasks under their Linear ids; estimates and branches stay
	try {
		const cycle = decode(await fs.readFile(options.cyclePath, "utf8"), {
			strict: false,
		}) as unknown as CycleData;
		for (const task of cycle.tasks) {
			const entry = mapping.issues.find((e) => e.local === task.id);
			if (!entry?.identifier) continue;
			task.id = entry.identifier;
			task.linearId = entry.id;
			task.sourceId = entry.id;
			task.sourceType = "linear";
			task.status = states.get(task.status)?.name ?? task.status;
			if (task.parentIssueId) {
				task.parentIssueId =
					mapping.issues.find((e) => e.local === task.parentIssueId)
						?.identifier ?? task.parentIssueId;
			}
			task.relations = undefined;
			task.url = undefined;
		}
		cycle.cycleName = `Migrated from local board ${board.team.key}`;
		cycle.updatedAt = new Date().toISOString();
		await fs.writeFile(options.cyclePath, encode(stripUndefined(cycle)));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (currentKeys.length === 0) {
		options.log(
			"No Linear user matched current_user: local.toon now tracks all users. Set it with 'ttt init' or by hand.",
		);
	}
}

function stripUndefined<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
