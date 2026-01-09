/**
 * Trello initialization flow
 */

import fs from "node:fs/promises";
import { select } from "@inquirer/prompts";
import { encode } from "@toon-format/toon";
import type {
	CompletionMode,
	Config,
	LocalConfig,
	SourceConfig,
	StatusTransitions,
} from "../../utils.js";
import type { LinearLabel } from "../config-builder.js";
import { TrelloClient } from "../trello.js";
import { updateGitignore } from "./file-ops.js";
import { selectLabelFilter, selectStatusSource } from "./prompts.js";
import { promptForTrelloCredentials } from "./trello-prompts.js";
import type { InitOptions, InitPaths } from "./types.js";

export async function initTrello(
	options: InitOptions,
	paths: InitPaths,
): Promise<void> {
	const credentials = await promptForTrelloCredentials(options);
	if (!credentials) {
		console.error("Error: Trello API key and token are required.");
		console.error("Get your API key from: https://trello.com/power-ups/admin");
		process.exit(1);
	}

	const client = new TrelloClient(credentials.apiKey, credentials.token);

	console.log("\n📡 Fetching data from Trello...");

	// Fetch boards (equivalent to teams)
	const boards = await client.getBoards();

	if (boards.length === 0) {
		console.error("Error: No boards found in your Trello account.");
		process.exit(1);
	}

	// Select board (dev team)
	let selectedBoard = boards[0];
	if (options.team) {
		const found = boards.find(
			(b) => b.name.toLowerCase() === options.team?.toLowerCase(),
		);
		if (found) selectedBoard = found;
	} else if (options.interactive && boards.length > 1) {
		console.log("\n📋 Board Selection:");
		const boardId = await select({
			message: "Select your board:",
			choices: boards.map((b) => ({ name: b.name, value: b.id })),
		});
		selectedBoard = boards.find((b) => b.id === boardId) || boards[0];
	}
	console.log(`  Board: ${selectedBoard.name}`);

	// Fetch lists (statuses), labels, and members
	const [lists, labels, members] = await Promise.all([
		client.getBoardLists(selectedBoard.id),
		client.getBoardLabels(selectedBoard.id),
		client.getBoardMembers(selectedBoard.id),
	]);

	console.log(`  Lists: ${lists.length}`);
	console.log(`  Labels: ${labels.filter((l) => l.name).length}`);
	console.log(`  Members: ${members.length}`);

	// Select user
	let currentMember = members[0];
	if (options.user) {
		const found = members.find(
			(m) =>
				m.username.toLowerCase() === options.user?.toLowerCase() ||
				m.fullName.toLowerCase() === options.user?.toLowerCase(),
		);
		if (found) currentMember = found;
	} else if (options.interactive && members.length > 0) {
		const memberId = await select({
			message: "Select yourself:",
			choices: members.map((m) => ({
				name: `${m.fullName} (@${m.username})`,
				value: m.id,
			})),
		});
		currentMember = members.find((m) => m.id === memberId) || members[0];
	}

	// Select status mappings (lists)
	const listChoices = lists.map((l) => ({ name: l.name, value: l.name }));
	let statusTransitions: StatusTransitions;

	if (options.interactive && lists.length > 0) {
		console.log("\n📊 Configure status mappings (lists):");

		const defaultTodo =
			lists.find((l) => /todo|backlog|to do/i.test(l.name))?.name ||
			lists[0]?.name;
		const defaultInProgress =
			lists.find((l) => /progress|doing|working/i.test(l.name))?.name ||
			lists[1]?.name;
		const defaultDone =
			lists.find((l) => /done|complete|finished/i.test(l.name))?.name ||
			lists[lists.length - 1]?.name;

		const todo = await select({
			message: 'Select list for "Todo" (pending tasks):',
			choices: listChoices,
			default: defaultTodo,
		});

		const in_progress = await select({
			message: 'Select list for "In Progress":',
			choices: listChoices,
			default: defaultInProgress,
		});

		const done = await select({
			message: 'Select list for "Done":',
			choices: listChoices,
			default: defaultDone,
		});

		statusTransitions = {
			todo: todo || lists[0]?.name || "Todo",
			in_progress: in_progress || lists[1]?.name || "In Progress",
			done: done || lists[lists.length - 1]?.name || "Done",
		};
	} else {
		// Auto-detect from list names
		statusTransitions = {
			todo:
				lists.find((l) => /todo|backlog|to do/i.test(l.name))?.name ||
				lists[0]?.name ||
				"Todo",
			in_progress:
				lists.find((l) => /progress|doing|working/i.test(l.name))?.name ||
				lists[1]?.name ||
				"In Progress",
			done:
				lists.find((l) => /done|complete|finished/i.test(l.name))?.name ||
				lists[lists.length - 1]?.name ||
				"Done",
		};
	}

	// Select label filter
	const validLabels = labels.filter((l) => l.name);
	const defaultLabel = await selectLabelFilter(
		validLabels.map(
			(l) =>
				({
					id: l.id,
					name: l.name,
					color: l.color ?? undefined,
				}) as LinearLabel,
		),
		options,
	);

	// Status source
	const statusSource = await selectStatusSource(options);

	// Completion mode (simplified for Trello - no QA/PM teams)
	const completionMode: CompletionMode = "simple";

	// Build config
	const teamsConfig: Record<string, { id: string; name: string }> = {};
	const teamKey = selectedBoard.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
	teamsConfig[teamKey] = { id: selectedBoard.id, name: selectedBoard.name };

	const usersConfig: Record<
		string,
		{ id: string; email: string; displayName: string }
	> = {};
	for (const member of members) {
		const userKey = member.username.toLowerCase().replace(/[^a-z0-9]/g, "_");
		usersConfig[userKey] = {
			id: member.id,
			email: "", // Trello doesn't expose email
			displayName: member.fullName || member.username,
		};
	}

	const labelsConfig: Record<
		string,
		{ id: string; name: string; color?: string }
	> = {};
	for (const label of validLabels) {
		const labelKey = label.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
		labelsConfig[labelKey] = {
			id: label.id,
			name: label.name,
			color: label.color ?? undefined,
		};
	}

	const statusesConfig: Record<string, { name: string; type: string }> = {};
	for (const list of lists) {
		const statusKey = list.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
		statusesConfig[statusKey] = { name: list.name, type: "list" };
	}

	const sourceConfig: SourceConfig = {
		type: "trello",
		trello: {
			// Don't store credentials in config for security
			// They should be in environment variables
		},
	};

	const config: Config = {
		source: sourceConfig,
		teams: teamsConfig,
		users: usersConfig,
		labels: labelsConfig,
		statuses: statusesConfig,
		status_transitions: statusTransitions,
	};

	// Find keys
	const currentUserKey =
		Object.entries(usersConfig).find(
			([_, u]) => u.id === currentMember.id,
		)?.[0] || Object.keys(usersConfig)[0];

	const localConfig: LocalConfig = {
		current_user: currentUserKey,
		team: teamKey,
		completion_mode: completionMode,
		labels: defaultLabel,
		status_source: statusSource,
	};

	// Write config files
	console.log("\n📝 Writing configuration files...");
	await fs.mkdir(paths.baseDir, { recursive: true });

	await fs.writeFile(paths.configPath, encode(config), "utf-8");
	console.log(`  ✓ ${paths.configPath}`);

	await fs.writeFile(paths.localPath, encode(localConfig), "utf-8");
	console.log(`  ✓ ${paths.localPath}`);

	// Update .gitignore
	await updateGitignore(".ttt", options.interactive ?? true);

	// Summary
	console.log("\n✅ Initialization complete!\n");
	console.log("Configuration summary:");
	console.log(`  Source: Trello`);
	console.log(`  Board: ${selectedBoard.name}`);
	console.log(`  User: ${currentMember.fullName} (@${currentMember.username})`);
	console.log(
		`  Label filters: ${defaultLabel && defaultLabel.length > 0 ? defaultLabel.join(", ") : "(none)"}`,
	);
	console.log(
		`  Status source: ${statusSource === "local" ? "local" : "remote"}`,
	);
	console.log(`  Status mappings:`);
	console.log(`    Todo: ${statusTransitions.todo}`);
	console.log(`    In Progress: ${statusTransitions.in_progress}`);
	console.log(`    Done: ${statusTransitions.done}`);

	console.log("\nNext steps:");
	if (!process.env.TRELLO_API_KEY || !process.env.TRELLO_TOKEN) {
		console.log("  1. Set environment variables:");
		console.log(`     export TRELLO_API_KEY="${credentials.apiKey}"`);
		console.log(`     export TRELLO_TOKEN="<your-token>"`);
		console.log("  2. Run sync: ttt sync");
		console.log("  3. Start working: ttt work-on");
	} else {
		console.log("  1. Run sync: ttt sync");
		console.log("  2. Start working: ttt work-on");
	}
}
