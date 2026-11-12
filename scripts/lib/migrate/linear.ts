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
import { withProcessLock } from "../file-lock.js";
import { listIssues, localBoardDir, readBoard } from "../local/store.js";
import type { LocalBoard, LocalIssue, LocalStatusDef } from "../local/types.js";
import { hasLeft } from "../order/model.js";
import { listOrders, renameTickets, stampFor } from "../order/store.js";
import type { WorkOrder } from "../order/types.js";

export class MigrateError extends Error {}

/** Another migrate run holds the lock; this one changed nothing. */
export class MigrateBusyError extends MigrateError {}

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
	/**
	 * Local `updated_at` of the version Linear holds: recorded when the create
	 * is sent and after each update. A later local one is sent as an update.
	 */
	updated_at?: string;
	/** Local identifier of the parent Linear holds; absent for none */
	parent?: string;
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

/** Held by a real (not dry) run from start to end. */
export function lockPath(): string {
	return path.join(localBoardDir(), "migration.lock");
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

/** Write to a temp file, then rename: a crash leaves the old file or the new. */
async function writeFileAtomic(file: string, content: string): Promise<void> {
	const temp = `${file}.${process.pid}.tmp`;
	await fs.writeFile(temp, content, "utf8");
	await fs.rename(temp, file);
}

async function writeMapping(mapping: MigrationFile): Promise<void> {
	await writeFileAtomic(mappingPath(), encode(mapping));
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
 * answer may be what got lost. `onAttempt` records, with the attempt, what
 * the create sends.
 */
async function createOnce(
	entry: Progress,
	lookup: () => Promise<unknown>,
	create: () => Promise<{ success: boolean }>,
	save: () => Promise<void>,
	what: string,
	onAttempt?: () => void,
): Promise<void> {
	if (entry.created) return;
	if (entry.attempted && (await exists(lookup))) {
		entry.created = true;
		await save();
		return;
	}
	onAttempt?.();
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

/** A team's estimate setting, as Linear names it. */
interface Estimation {
	type: string;
	extended: boolean;
	allowZero: boolean;
}

/** Points of each scale; the last two only with the extended setting. */
const ESTIMATE_SCALES: Record<string, number[]> = {
	exponential: [1, 2, 4, 8, 16, 32, 64],
	fibonacci: [1, 2, 3, 5, 8, 13, 21],
	linear: [1, 2, 3, 4, 5, 6, 7],
	// T-shirt sizes XS..XXXL, stored as Fibonacci points
	tShirt: [1, 2, 3, 5, 8, 13, 21],
};

/**
 * Estimates the team takes: none when it does not use them, undefined for
 * a scale this version does not know (Linear then decides).
 */
function allowedEstimates(estimation: Estimation): number[] | undefined {
	if (estimation.type === "notUsed") return [];
	const scale = ESTIMATE_SCALES[estimation.type];
	if (!scale) return undefined;
	const points = scale.slice(0, estimation.extended ? 7 : 5);
	return estimation.allowZero ? [0, ...points] : points;
}

interface LinearTarget {
	team: {
		id: string;
		name: string;
		key: string;
		icon?: string;
		estimation: Estimation;
	};
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
			estimation: {
				type: team.issueEstimationType,
				extended: Boolean(team.issueEstimationExtended),
				allowZero: Boolean(team.issueEstimationAllowZero),
			},
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

/**
 * Orders holding tickets this migration renames. Refuses when an order still
 * working a ticket names an id that is neither on the board nor migrated:
 * after the switch `ttt order` would look it up in Linear and could act on
 * an unrelated issue there.
 */
function checkOrders(
	orders: WorkOrder[],
	issues: LocalIssue[],
	mapping: MigrationFile,
): WorkOrder[] {
	const known = new Set([
		...issues.map((i) => i.identifier),
		...mapping.issues.filter((e) => e.identifier).map((e) => e.local),
	]);
	const dangling = orders.flatMap((order) =>
		order.stage === "closed"
			? []
			: order.tickets
					.filter((t) => !known.has(t.id) && !hasLeft(t) && t.state !== "done")
					.map((t) => `${t.id} (${order.id})`),
	);
	if (dangling.length > 0) {
		throw new MigrateError(
			`Work orders still work tickets that are not on the local board: ${dangling.join(", ")}. After the switch, ttt order would look these ids up in Linear. Drop them first ('ttt order drop <order> <ticket> --reason ...').`,
		);
	}
	return orders.filter((order) => order.tickets.some((t) => known.has(t.id)));
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

/**
 * A real run holds `.ttt/local/migration.lock` throughout: two runs that
 * both found no mapping would each create the whole board under their own
 * ids. A dry run only reads.
 */
export async function migrateToLinear(options: MigrateOptions): Promise<void> {
	if (options.dryRun) return runMigration(options);
	await fs.mkdir(localBoardDir(), { recursive: true });
	return withProcessLock(
		lockPath(),
		(holder) =>
			new MigrateBusyError(
				`Another ttt migrate is running (${lockPath()}: ${holder}). Wait for it to finish; if no migrate runs on this machine, remove the file.`,
			),
		() => runMigration(options),
	);
}

async function runMigration(options: MigrateOptions): Promise<void> {
	const { client, config, log } = options;
	const board: LocalBoard = await readBoard();
	const issues = await listIssues();
	const previous = await readMapping();
	if (previous?.finished_at) {
		throw new MigrateError(
			`This board was already migrated to Linear team ${previous.target.team_key ?? previous.target.team_id} at ${previous.finished_at} (${mappingPath()}).`,
		);
	}
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
	/** Created earlier, and edited locally since Linear got it */
	const stale = (issue: LocalIssue, entry: IssueEntry | undefined) =>
		Boolean(
			entry?.created &&
				(!entry.updated_at || issue.updated_at > entry.updated_at),
		);

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
	// An estimate the team does not take would fail the create: leave it out
	const allowed = allowedEstimates(target.team.estimation);
	const estimateOf = (issue: LocalIssue) =>
		issue.estimate !== undefined && allowed && !allowed.includes(issue.estimate)
			? undefined
			: issue.estimate;
	const offScale = issues.filter((i) => estimateOf(i) !== i.estimate);
	if (offScale.length > 0) {
		const scale =
			allowed && allowed.length > 0
				? `takes ${target.team.estimation.type} estimates ${allowed.join(", ")}`
				: "does not use estimates";
		log(
			`Team ${target.team.key} ${scale}: ${offScale.map((i) => `${i.identifier} (${i.estimate})`).join(", ")} go in without an estimate; the local board keeps it.`,
		);
	}
	const orders = checkOrders(await listOrders(), issues, mapping);
	if (orders.length > 0) {
		log(
			`Work orders that switch to the Linear ids: ${orders.map((o) => `${o.id}${o.handed_off ? " (handed off: its writer's copy keeps the local ids)" : ""}`).join(", ")}`,
		);
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
			? `${stale(issue, entry) ? "update" : "already"} ${entry.identifier ?? "created"}`
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
	/** What Linear holds of an issue, parent aside; null clears a field */
	const fieldsOf = (issue: LocalIssue) => ({
		title: issue.title,
		description: issue.description ?? null,
		priority: issue.priority,
		stateId: states.get(issue.state)?.id,
		labelIds: issue.labels.map(labelId),
		assigneeId: (issue.assignee && users.map.get(issue.assignee)) || null,
		estimate: estimateOf(issue) ?? null,
	});

	for (const issue of issues) {
		const entry = entryOf(issue.identifier);
		await createOnce(
			entry,
			() => client.issue(entry.id),
			() =>
				client.createIssue({
					id: entry.id,
					teamId: target.team.id,
					...fieldsOf(issue),
					createdAt: new Date(issue.created_at),
				}),
			save,
			`${issue.identifier}`,
			() => {
				entry.updated_at = issue.updated_at;
			},
		);
		if (!entry.identifier) {
			entry.identifier = (
				await withRetry(() => client.issue(entry.id))
			).identifier;
			await save();
		}
		if (stale(issue, entry)) {
			// Edited locally after an earlier run created it
			const payload = await withRetry(() =>
				client.updateIssue(entry.id, fieldsOf(issue)),
			);
			if (!payload.success) {
				throw new MigrateError(`Updating ${entry.identifier} failed.`);
			}
			entry.updated_at = issue.updated_at;
			await save();
			log(`↻ ${issue.identifier} → ${entry.identifier} (updated)`);
		} else {
			log(`✓ ${issue.identifier} → ${entry.identifier}`);
		}
	}

	for (const issue of issues) {
		const entry = entryOf(issue.identifier);
		// The parent Linear should hold: the local one, once it is migrated
		const wanted =
			issue.parent && entryOf(issue.parent)?.created ? issue.parent : undefined;
		if (issue.parent && !wanted) {
			log(
				`  ${issue.identifier}: its parent ${issue.parent} is not on the board; left without a parent.`,
			);
		}
		if (wanted !== (entry.parent ?? undefined)) {
			const payload = await withRetry(() =>
				client.updateIssue(entry.id, {
					parentId: wanted ? entryOf(wanted).id : null,
				}),
			);
			if (!payload.success) {
				throw new MigrateError(
					`Setting the parent of ${issue.identifier} failed.`,
				);
			}
			if (wanted) entry.parent = wanted;
			else delete entry.parent;
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

	// Issues added or edited on the board while this ran: Linear lacks them
	const now = await listIssues();
	const late = now.filter((i) => {
		const entry = mapping.issues.find((e) => e.local === i.identifier);
		return !entry?.created || stale(i, entry);
	});
	if (late.length > 0) {
		throw new MigrateError(
			`${late.map((i) => i.identifier).join(", ")} appeared or changed on the board during the run; rerun to carry them over.`,
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

	// Work orders: once config.toon names Linear, `ttt order` looks each
	// ticket up there, where a local id may name another team's issue
	const ids = new Map(
		mapping.issues
			.filter((e) => e.identifier)
			.map((e) => [e.local, e.identifier as string]),
	);
	const renamed = await renameTickets(
		ids,
		`ttt migrate moved the tickets to Linear (${mapping.started_at})`,
		stampFor(localConfig),
	);
	if (renamed.length > 0) {
		options.log(`Work orders now naming the Linear ids: ${renamed.join(", ")}`);
	}

	// cycle.toon: same tasks under their Linear ids; estimates and branches
	// stay. A task already moved (a rerun after a crash) is left alone.
	try {
		const cycle = decode(await fs.readFile(options.cyclePath, "utf8"), {
			strict: false,
		}) as unknown as CycleData;
		for (const task of cycle.tasks) {
			if (task.sourceType === "linear") continue;
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
		await writeFileAtomic(options.cyclePath, encode(stripUndefined(cycle)));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}

	// config.toon last: until it names Linear, a rerun can finish the switch
	await writeFileAtomic(options.localPath, encode(stripUndefined(nextLocal)));
	await writeFileAtomic(
		options.configPath,
		encode(stripUndefined(linearConfig)),
	);
	if (currentKeys.length === 0) {
		options.log(
			"No Linear user matched current_user: local.toon now tracks all users. Set it with 'ttt init' or by hand.",
		);
	}
}

function stripUndefined<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
