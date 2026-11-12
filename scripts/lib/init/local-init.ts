/**
 * Local source initialization: a work board kept in `.ttt/local`, no login.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { input } from "@inquirer/prompts";
import { decode, encode } from "@toon-format/toon";
import type {
	Config,
	CycleData,
	LocalConfig,
	StatusTransitions,
	UserConfig,
} from "../../utils.js";
import { boardExists, initBoard, readBoard, transact } from "../local/store.js";
import {
	LOCAL_STATUS_TYPES,
	type LocalBoard,
	type LocalLabelDef,
	type LocalStatusDef,
	type LocalStatusType,
} from "../local/types.js";
import { updateGitignore } from "./file-ops.js";
import type { InitOptions, InitPaths } from "./types.js";

/** Linear's default workflow for a new team. */
export const DEFAULT_LOCAL_STATUSES =
	"Backlog, Todo, In Progress, In Review, Done, Canceled";

const TYPE_PATTERNS: [RegExp, LocalStatusType][] = [
	[/cancel|drop|won'?t|duplicate|reject|abandon/i, "canceled"],
	[
		/done|complete|finish|closed|shipped|merged|released|resolved/i,
		"completed",
	],
	[/backlog|icebox|triage|someday/i, "backlog"],
	[/progress|doing|review|test|qa|start|active|wip|working/i, "started"],
];

export class InitError extends Error {}

/** A key from any name: lower case, runs of other characters become `_`. */
export function slugKey(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_+|_+$/g, "") || "user"
	);
}

function statusId(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function inferStatusType(name: string): LocalStatusType {
	return (
		TYPE_PATTERNS.find(([pattern]) => pattern.test(name))?.[1] ?? "unstarted"
	);
}

/**
 * Parse "Todo, Doing, Review:started, Done" into statuses. A type after `:`
 * wins; otherwise it is guessed from the name. The list needs a todo, a
 * started, and a completed status, because claim and done move to them.
 */
export function parseStatusList(text: string): LocalStatusDef[] {
	const statuses = text
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const [rawName, rawType] = part.split(":").map((p) => p.trim());
			const type = (rawType?.toLowerCase() ||
				inferStatusType(rawName)) as LocalStatusType;
			if (!LOCAL_STATUS_TYPES.includes(type)) {
				throw new InitError(
					`Status "${rawName}" has type "${rawType}"; use one of ${LOCAL_STATUS_TYPES.join(", ")}.`,
				);
			}
			if (!rawName || !statusId(rawName)) {
				throw new InitError(`"${part}" is not a status name.`);
			}
			return { id: statusId(rawName), name: rawName, type };
		});

	const ids = new Set<string>();
	for (const s of statuses) {
		if (ids.has(s.id))
			throw new InitError(`Status "${s.name}" is listed twice.`);
		ids.add(s.id);
	}
	const missing = [
		statuses.some((s) => s.type === "unstarted" || s.type === "backlog")
			? ""
			: "a todo status (unstarted)",
		statuses.some((s) => s.type === "started")
			? ""
			: "an in-progress status (started)",
		statuses.some((s) => s.type === "completed")
			? ""
			: "a done status (completed)",
	].filter(Boolean);
	if (missing.length > 0) {
		throw new InitError(`The status list needs ${missing.join(", ")}.`);
	}
	return statuses;
}

/** Which status claim, done, and review move to, from the status types. */
export function transitionsFor(statuses: LocalStatusDef[]): StatusTransitions {
	const todo =
		statuses.find((s) => s.type === "unstarted") ??
		statuses.find((s) => s.type === "backlog");
	const started = statuses.filter((s) => s.type === "started");
	const done = statuses.find((s) => s.type === "completed");
	const testing =
		started.slice(1).find((s) => /review|test|qa/i.test(s.name)) ?? started[1];
	const transitions: StatusTransitions = {
		todo: todo?.name ?? statuses[0].name,
		in_progress: started[0]?.name ?? statuses[0].name,
		done: done?.name ?? statuses[statuses.length - 1].name,
	};
	if (testing) transitions.testing = testing.name;
	return transitions;
}

export function normalizeTeamKey(raw: string): string {
	const key = raw.trim().toUpperCase();
	if (!/^[A-Z][A-Z0-9]{0,9}$/.test(key)) {
		throw new InitError(
			`"${raw}" is not a team key: use 1-10 letters or digits, starting with a letter (e.g. MP).`,
		);
	}
	return key;
}

/** A key from the project directory's name: its first three letters. */
export function deriveTeamKey(projectDir: string): string {
	const letters = path.basename(projectDir).replace(/[^a-zA-Z]/g, "");
	return letters ? letters.slice(0, 3).toUpperCase() : "TTT";
}

function labelDefs(names: string[]): LocalLabelDef[] {
	const seen = new Set<string>();
	const labels: LocalLabelDef[] = [];
	for (const name of names.map((n) => n.trim()).filter(Boolean)) {
		const id = statusId(name);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		labels.push({ id, name });
	}
	return labels;
}

function splitList(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((v) => v.trim())
		.filter(Boolean);
}

interface LocalAnswers {
	teamKey: string;
	teamName: string;
	userName: string;
	email?: string;
	members: string[];
	statuses: LocalStatusDef[];
	labels: string[];
}

async function readExistingConfig(file: string): Promise<Config | undefined> {
	try {
		const config = decode(await fs.readFile(file, "utf8"), {
			strict: false,
		}) as unknown as Config;
		return config.source?.type === "local" ? config : undefined;
	} catch {
		return undefined;
	}
}

async function promptAnswers(
	options: InitOptions,
	paths: InitPaths,
	existing: LocalBoard | undefined,
): Promise<LocalAnswers> {
	const interactive = options.interactive ?? true;
	const projectDir = path.dirname(paths.baseDir);
	const osUser = os.userInfo().username;

	if (existing && options.team) {
		const asked = normalizeTeamKey(options.team);
		if (asked !== existing.team.key) {
			throw new InitError(
				`The local board's team key is ${existing.team.key}; its issues are numbered ${existing.team.key}-<n>. Re-run with --team ${existing.team.key}.`,
			);
		}
	}

	let teamKey =
		existing?.team.key ??
		normalizeTeamKey(options.team ?? deriveTeamKey(projectDir));
	let teamName = existing?.team.name ?? options.teamName ?? teamKey;
	let userName = options.user ?? osUser;
	let email = options.email;
	let members = options.members ?? [];
	let statusText = options.statuses ?? DEFAULT_LOCAL_STATUSES;
	let labelText = (options.labels ?? []).join(", ");

	if (interactive) {
		console.log("\n🗂  Local board setup (stored in .ttt/local, no login):");
		if (!existing) {
			if (!options.team) {
				teamKey = normalizeTeamKey(
					await input({
						message: "Team key (issue prefix, e.g. MP → MP-1):",
						default: teamKey,
						validate: (v) => {
							try {
								normalizeTeamKey(v);
								return true;
							} catch (error) {
								return (error as Error).message;
							}
						},
					}),
				);
			}
			if (!options.teamName) {
				teamName = await input({ message: "Team name:", default: teamKey });
			}
		} else {
			console.log(
				`  Existing board ${existing.team.key} kept (issues and numbering stay).`,
			);
		}
		if (!options.user) {
			userName = await input({ message: "Your name:", default: osUser });
		}
		if (options.email === undefined) {
			email =
				(await input({
					message:
						"Your email (optional; matches your Linear account if you migrate later):",
					default: "",
				})) || undefined;
		}
		if (!options.members) {
			members = splitList(
				await input({
					message: "Other team members (comma-separated, optional):",
					default: "",
				}),
			);
		}
		if (!existing && !options.statuses) {
			statusText = await input({
				message:
					"Statuses in workflow order (Name or Name:type; types: backlog, unstarted, started, completed, canceled):",
				default: DEFAULT_LOCAL_STATUSES,
				validate: (v) => {
					try {
						parseStatusList(v);
						return true;
					} catch (error) {
						return (error as Error).message;
					}
				},
			});
		}
		if (!options.labels) {
			labelText = await input({
				message: "Labels (comma-separated, optional):",
				default: "",
			});
		}
	}

	return {
		teamKey,
		teamName: teamName.trim() || teamKey,
		userName: userName.trim() || osUser,
		email: email?.trim() || undefined,
		members,
		statuses: existing ? existing.statuses : parseStatusList(statusText),
		labels: splitList(labelText),
	};
}

export async function initLocal(
	options: InitOptions,
	paths: InitPaths,
): Promise<void> {
	try {
		await runInitLocal(options, paths);
	} catch (error) {
		if (error instanceof Error) {
			console.error(`Error: ${error.message}`);
			process.exit(1);
		}
		throw error;
	}
}

async function runInitLocal(
	options: InitOptions,
	paths: InitPaths,
): Promise<void> {
	await fs.mkdir(paths.baseDir, { recursive: true });
	const existing = (await boardExists()) ? await readBoard() : undefined;
	if (existing && options.statuses) {
		console.log(
			"  ℹ The board already has statuses; --statuses is ignored. Edit .ttt/local/board.toon to change them.",
		);
	}
	const answers = await promptAnswers(options, paths, existing);

	// The board: new, or the existing one with any new labels added
	const { board } = await initBoard({
		version: 1,
		team: { key: answers.teamKey, name: answers.teamName },
		next_number: 1,
		statuses: answers.statuses,
		labels: labelDefs(answers.labels),
	});
	if (existing) {
		await transact(async (tx) => {
			const known = new Set(tx.board.labels.map((l) => l.id));
			for (const label of labelDefs(answers.labels)) {
				if (!known.has(label.id)) tx.board.labels.push(label);
			}
		});
	}
	const finalBoard = existing ? await readBoard() : board;

	// Users: keep the ones an earlier local init wrote, then add these
	const previous = await readExistingConfig(paths.configPath);
	const users: Record<string, UserConfig> = { ...(previous?.users ?? {}) };
	const addUser = (name: string, email?: string) => {
		const key = slugKey(name);
		users[key] = {
			id: key,
			email: email ?? users[key]?.email ?? `${key}@local`,
			displayName: name,
		};
		return key;
	};
	const currentUser = addUser(answers.userName, answers.email);
	for (const member of answers.members) {
		if (slugKey(member) !== currentUser) addUser(member);
	}

	const teamConfigKey = finalBoard.team.key.toLowerCase();
	const config: Config = {
		source: { type: "local" },
		teams: {
			[teamConfigKey]: { id: finalBoard.team.key, name: finalBoard.team.name },
		},
		users,
		labels: Object.fromEntries(
			finalBoard.labels.map((l) => [
				slugKey(l.name),
				{ id: l.id, name: l.name, ...(l.color ? { color: l.color } : {}) },
			]),
		),
		statuses: Object.fromEntries(
			finalBoard.statuses.map((s) => [
				slugKey(s.name),
				{ name: s.name, type: s.type },
			]),
		),
		status_transitions: transitionsFor(finalBoard.statuses),
	};
	const localConfig: LocalConfig = {
		current_user: currentUser,
		team: teamConfigKey,
		completion_mode: "simple",
		// The board is the source: commands write it at once
		status_source: "remote",
	};

	console.log("\n📝 Writing configuration files...");
	await fs.writeFile(paths.configPath, encode(config), "utf-8");
	console.log(`  ✓ ${paths.configPath}`);
	await fs.writeFile(paths.localPath, encode(localConfig), "utf-8");
	console.log(`  ✓ ${paths.localPath}`);
	console.log(`  ✓ ${path.join(paths.baseDir, "local", "board.toon")}`);

	try {
		await fs.access(paths.cyclePath);
	} catch {
		const cycle: CycleData = {
			cycleId: "local",
			cycleName: `${finalBoard.team.key} board`,
			updatedAt: new Date().toISOString(),
			tasks: [],
		};
		await fs.writeFile(paths.cyclePath, encode(cycle), "utf-8");
		console.log(`  ✓ ${paths.cyclePath}`);
	}

	await updateGitignore(".ttt", options.interactive ?? true);

	const transitions = config.status_transitions as StatusTransitions;
	console.log("\n✅ Initialization complete!\n");
	console.log("Configuration summary:");
	console.log("  Source: Local board (.ttt/local, no login)");
	console.log(
		`  Team: ${finalBoard.team.name} (issues ${finalBoard.team.key}-<n>)`,
	);
	console.log(`  User: ${users[currentUser].displayName} (${currentUser})`);
	console.log(
		`  Statuses: ${finalBoard.statuses.map((s) => `${s.name} [${s.type}]`).join(", ")}`,
	);
	console.log(
		`  Labels: ${finalBoard.labels.map((l) => l.name).join(", ") || "(none)"}`,
	);
	console.log(
		`  Claim → ${transitions.in_progress}, done → ${transitions.done}${transitions.testing ? `, review → ${transitions.testing}` : ""}`,
	);
	console.log("\nNext steps:");
	console.log('  1. Create an issue: ttt create -t "First task"');
	console.log("  2. Claim it: ttt claim next");
	console.log("  3. Move to Linear later: ttt migrate --to linear --dry-run");
}
