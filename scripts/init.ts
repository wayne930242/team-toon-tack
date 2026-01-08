#!/usr/bin/env bun
import fs from "node:fs/promises";
import path from "node:path";
import { decode, encode } from "@toon-format/toon";
import prompts from "prompts";
import {
	buildConfig,
	buildLocalConfig,
	findTeamKey,
	findUserKey,
	getDefaultStatusTransitions,
	type LinearCycle,
	type LinearLabel,
	type LinearState,
	type LinearTeam,
	type LinearUser,
} from "./lib/config-builder.js";
import {
	type Config,
	fileExists,
	getLinearClient,
	getPaths,
	type LocalConfig,
	type StatusTransitions,
} from "./utils.js";

interface InitOptions {
	apiKey?: string;
	user?: string;
	team?: string;
	label?: string;
	force?: boolean;
	interactive?: boolean;
}

function parseArgs(args: string[]): InitOptions {
	const options: InitOptions = { interactive: true };

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case "--api-key":
			case "-k":
				options.apiKey = args[++i];
				break;
			case "--user":
			case "-u":
				options.user = args[++i];
				break;
			case "--team":
			case "-t":
				options.team = args[++i];
				break;
			case "--label":
			case "-l":
				options.label = args[++i];
				break;
			case "--force":
			case "-f":
				options.force = true;
				break;
			case "--yes":
			case "-y":
				options.interactive = false;
				break;
			case "--help":
			case "-h":
				printHelp();
				process.exit(0);
		}
	}

	return options;
}

function printHelp() {
	console.log(`
linear-toon init - Initialize configuration files

USAGE:
  bun run init [OPTIONS]

OPTIONS:
  -k, --api-key <key>   Linear API key (or set LINEAR_API_KEY env)
  -u, --user <email>    Your email address in Linear
  -t, --team <name>     Team name to sync (optional, fetches from Linear)
  -l, --label <name>    Default label filter (e.g., Frontend, Backend)
  -f, --force           Overwrite existing config files
  -y, --yes             Non-interactive mode (use defaults/provided args)
  -h, --help            Show this help message

EXAMPLES:
  bun run init
  bun run init --user alice@example.com --label Frontend
  bun run init -k lin_api_xxx -y
`);
}

async function promptForApiKey(
	options: InitOptions,
): Promise<string | undefined> {
	let apiKey = options.apiKey || process.env.LINEAR_API_KEY;
	if (!apiKey && options.interactive) {
		const response = await prompts({
			type: "password",
			name: "apiKey",
			message: "Enter your Linear API key:",
			validate: (v) =>
				v.startsWith("lin_api_")
					? true
					: 'API key should start with "lin_api_"',
		});
		apiKey = response.apiKey;
	}
	return apiKey;
}

async function selectTeams(
	teams: LinearTeam[],
	options: InitOptions,
): Promise<{ selected: LinearTeam[]; primary: LinearTeam }> {
	let selectedTeams = [teams[0]];
	let primaryTeam = teams[0];

	if (options.team) {
		const found = teams.find(
			(t) => t.name.toLowerCase() === options.team?.toLowerCase(),
		);
		if (found) {
			selectedTeams = [found];
			primaryTeam = found;
		}
	} else if (options.interactive && teams.length > 1) {
		const response = await prompts({
			type: "multiselect",
			name: "teamIds",
			message: "Select teams to sync (space to select, enter to confirm):",
			choices: teams.map((t) => ({ title: t.name, value: t.id })),
			min: 1,
		});

		if (response.teamIds && response.teamIds.length > 0) {
			selectedTeams = teams.filter((t) => response.teamIds.includes(t.id));

			if (selectedTeams.length > 1) {
				const primaryResponse = await prompts({
					type: "select",
					name: "primaryTeamId",
					message: "Select your primary team (for work-on/done commands):",
					choices: selectedTeams.map((t) => ({ title: t.name, value: t.id })),
				});
				primaryTeam =
					selectedTeams.find((t) => t.id === primaryResponse.primaryTeamId) ||
					selectedTeams[0];
			} else {
				primaryTeam = selectedTeams[0];
			}
		}
	}

	return { selected: selectedTeams, primary: primaryTeam };
}

async function selectQaPmTeam(
	teams: LinearTeam[],
	primaryTeam: LinearTeam,
	options: InitOptions,
): Promise<LinearTeam | undefined> {
	// Only ask if there are multiple teams and interactive mode
	if (!options.interactive || teams.length <= 1) {
		return undefined;
	}

	// Filter out primary team from choices
	const otherTeams = teams.filter((t) => t.id !== primaryTeam.id);
	if (otherTeams.length === 0) {
		return undefined;
	}

	console.log("\n🔗 QA/PM Team Configuration:");
	const response = await prompts({
		type: "select",
		name: "qaPmTeamId",
		message: "Select QA/PM team (for cross-team parent issue updates):",
		choices: [
			{
				title: "(None - skip)",
				value: undefined,
				description: "No cross-team parent updates",
			},
			...otherTeams.map((t) => ({
				title: t.name,
				value: t.id,
				description: "Parent issues in this team will be updated to Testing",
			})),
		],
		initial: 0,
	});

	if (!response.qaPmTeamId) {
		return undefined;
	}

	return teams.find((t) => t.id === response.qaPmTeamId);
}

async function selectUser(
	users: LinearUser[],
	options: InitOptions,
): Promise<LinearUser> {
	let currentUser = users[0];
	if (options.user) {
		const found = users.find(
			(u) =>
				u.email?.toLowerCase() === options.user?.toLowerCase() ||
				u.displayName?.toLowerCase() === options.user?.toLowerCase(),
		);
		if (found) currentUser = found;
	} else if (options.interactive) {
		const response = await prompts({
			type: "select",
			name: "userId",
			message: "Select yourself:",
			choices: users.map((u) => ({
				title: `${u.displayName || u.name} (${u.email})`,
				value: u.id,
			})),
		});
		currentUser = users.find((u) => u.id === response.userId) || users[0];
	}
	return currentUser;
}

async function selectLabelFilter(
	labels: LinearLabel[],
	options: InitOptions,
): Promise<string | undefined> {
	if (options.label) {
		return options.label;
	}

	if (options.interactive && labels.length > 0) {
		const labelChoices = [
			{ title: "(No filter - sync all labels)", value: undefined },
			...labels.map((l) => ({ title: l.name, value: l.name })),
		];
		const response = await prompts({
			type: "select",
			name: "label",
			message: "Select label filter (optional):",
			choices: labelChoices,
		});
		return response.label;
	}

	return undefined;
}

async function selectStatusSource(
	options: InitOptions,
): Promise<"remote" | "local"> {
	if (!options.interactive) {
		return "remote"; // default
	}

	console.log("\n🔄 Configure status sync mode:");
	const response = await prompts({
		type: "select",
		name: "statusSource",
		message: "Where should status updates be stored?",
		choices: [
			{
				title: "Remote (recommended)",
				value: "remote",
				description:
					"Update Linear immediately when you work-on or complete tasks",
			},
			{
				title: "Local",
				value: "local",
				description: "Work offline, then sync to Linear with 'sync --update'",
			},
		],
		initial: 0,
	});

	return response.statusSource || "remote";
}

async function selectStatusMappings(
	states: LinearState[],
	options: InitOptions,
): Promise<StatusTransitions> {
	const defaults = getDefaultStatusTransitions(states);

	if (!options.interactive || states.length === 0) {
		return defaults;
	}

	console.log("\n📊 Configure status mappings:");

	const stateChoices = states.map((s) => ({
		title: `${s.name} (${s.type})`,
		value: s.name,
	}));

	const todoResponse = await prompts({
		type: "select",
		name: "todo",
		message: 'Select status for "Todo" (pending tasks):',
		choices: stateChoices,
		initial: stateChoices.findIndex((c) => c.value === defaults.todo),
	});

	const inProgressResponse = await prompts({
		type: "select",
		name: "in_progress",
		message: 'Select status for "In Progress" (working tasks):',
		choices: stateChoices,
		initial: stateChoices.findIndex((c) => c.value === defaults.in_progress),
	});

	const doneResponse = await prompts({
		type: "select",
		name: "done",
		message: 'Select status for "Done" (completed tasks):',
		choices: stateChoices,
		initial: stateChoices.findIndex((c) => c.value === defaults.done),
	});

	const testingChoices = [
		{ title: "(None)", value: undefined },
		...stateChoices,
	];
	const testingResponse = await prompts({
		type: "select",
		name: "testing",
		message: 'Select status for "Testing" (optional, for parent tasks):',
		choices: testingChoices,
		initial: defaults.testing
			? testingChoices.findIndex((c) => c.value === defaults.testing)
			: 0,
	});

	const blockedChoices = [
		{ title: "(None)", value: undefined },
		...stateChoices,
	];
	const blockedResponse = await prompts({
		type: "select",
		name: "blocked",
		message: 'Select status for "Blocked" (optional, for blocked tasks):',
		choices: blockedChoices,
		initial: defaults.blocked
			? blockedChoices.findIndex((c) => c.value === defaults.blocked)
			: 0,
	});

	return {
		todo: todoResponse.todo || defaults.todo,
		in_progress: inProgressResponse.in_progress || defaults.in_progress,
		done: doneResponse.done || defaults.done,
		testing: testingResponse.testing,
		blocked: blockedResponse.blocked,
	};
}

async function updateGitignore(tttDir: string, interactive: boolean) {
	const gitignorePath = ".gitignore";
	const entry = `${tttDir}/`;

	try {
		let content = "";
		let exists = false;

		try {
			content = await fs.readFile(gitignorePath, "utf-8");
			exists = true;
		} catch {
			// .gitignore doesn't exist
		}

		// Check if already ignored
		const lines = content.split("\n");
		const alreadyIgnored = lines.some(
			(line) =>
				line.trim() === entry ||
				line.trim() === tttDir ||
				line.trim() === `/${entry}` ||
				line.trim() === `/${tttDir}`,
		);

		if (alreadyIgnored) {
			return;
		}

		// Ask user in interactive mode
		if (interactive) {
			const { addToGitignore } = await prompts({
				type: "confirm",
				name: "addToGitignore",
				message: `Add ${entry} to .gitignore?`,
				initial: true,
			});
			if (!addToGitignore) return;
		}

		// Add to .gitignore
		const newContent = exists
			? content.endsWith("\n")
				? `${content}${entry}\n`
				: `${content}\n${entry}\n`
			: `${entry}\n`;

		await fs.writeFile(gitignorePath, newContent, "utf-8");
		console.log(`  ✓ Added ${entry} to .gitignore`);
	} catch (_error) {
		// Silently ignore gitignore errors
	}
}

async function installClaudeCommands(
	interactive: boolean,
	statusSource: "remote" | "local",
): Promise<{ installed: boolean; prefix: string }> {
	if (!interactive) {
		return { installed: false, prefix: "" };
	}

	console.log("\n🤖 Claude Code Commands:");

	// Ask if user wants to install commands
	const { install } = await prompts({
		type: "confirm",
		name: "install",
		message: "Install Claude Code commands? (work-on, done-job, sync-linear)",
		initial: true,
	});

	if (!install) {
		return { installed: false, prefix: "" };
	}

	// Ask for prefix
	const { prefixChoice } = await prompts({
		type: "select",
		name: "prefixChoice",
		message: "Command prefix style:",
		choices: [
			{
				title: "No prefix (recommended)",
				value: "",
				description: "/work-on, /done-job, /sync-linear",
			},
			{
				title: "ttt:",
				value: "ttt:",
				description: "/ttt:work-on, /ttt:done-job, /ttt:sync-linear",
			},
			{
				title: "linear:",
				value: "linear:",
				description: "/linear:work-on, /linear:done-job, /linear:sync-linear",
			},
			{
				title: "Custom...",
				value: "custom",
				description: "Enter your own prefix",
			},
		],
		initial: 0,
	});

	let prefix = prefixChoice || "";

	if (prefixChoice === "custom") {
		const { customPrefix } = await prompts({
			type: "text",
			name: "customPrefix",
			message: "Enter custom prefix (e.g., 'my:'):",
			initial: "",
		});
		prefix = customPrefix || "";
	}

	// Find templates directory
	// Try multiple locations: installed package, local dev
	const possibleTemplatePaths = [
		path.join(__dirname, "..", "templates", "claude-code-commands"),
		path.join(__dirname, "..", "..", "templates", "claude-code-commands"),
		path.join(process.cwd(), "templates", "claude-code-commands"),
	];

	let templateDir: string | null = null;
	for (const p of possibleTemplatePaths) {
		try {
			await fs.access(p);
			templateDir = p;
			break;
		} catch {
			// Try next path
		}
	}

	if (!templateDir) {
		// Try to get repo URL from package.json
		let repoUrl = "https://github.com/wayne930242/team-toon-tack";
		try {
			const pkgPaths = [
				path.join(__dirname, "..", "package.json"),
				path.join(__dirname, "..", "..", "package.json"),
			];
			for (const pkgPath of pkgPaths) {
				try {
					const pkgContent = await fs.readFile(pkgPath, "utf-8");
					const pkg = JSON.parse(pkgContent);
					if (pkg.repository?.url) {
						// Parse git+https://github.com/user/repo.git format
						repoUrl = pkg.repository.url
							.replace(/^git\+/, "")
							.replace(/\.git$/, "");
					}
					break;
				} catch {
					// Try next path
				}
			}
		} catch {
			// Use default URL
		}

		console.log(
			"  ⚠ Could not find command templates. Please copy manually from:",
		);
		console.log(`    ${repoUrl}/tree/main/templates/claude-code-commands`);
		return { installed: false, prefix };
	}

	// Create .claude/commands directory
	const commandsDir = path.join(process.cwd(), ".claude", "commands");
	await fs.mkdir(commandsDir, { recursive: true });

	// Copy and rename template files
	const templateFiles = await fs.readdir(templateDir);
	const commandFiles = templateFiles.filter((f) => f.endsWith(".md"));

	for (const file of commandFiles) {
		const baseName = file.replace(".md", "");
		const newFileName = prefix ? `${prefix}${baseName}.md` : file;
		const srcPath = path.join(templateDir, file);
		const destPath = path.join(commandsDir, newFileName);

		// Read template content
		let content = await fs.readFile(srcPath, "utf-8");

		// Update the name in frontmatter if prefix is used
		if (prefix) {
			content = content.replace(
				/^(---\s*\n[\s\S]*?name:\s*)(\S+)/m,
				`$1${prefix}${baseName}`,
			);
		}

		// Modify content based on statusSource for work-on and done-job
		if (statusSource === "local") {
			if (baseName === "work-on" || baseName.endsWith("work-on")) {
				// Update description for local mode
				content = content.replace(
					/Select a task and update status to "In Progress" on both local and Linear\./,
					'Select a task and update local status to "In Progress". (Linear will be updated when you run `sync --update`)',
				);
				// Add reminder after Complete section
				content = content.replace(
					/Use `?\/done-job`? to mark task as completed/,
					"Use `/done-job` to mark task as completed\n\n### 7. Sync to Linear\n\nWhen ready to update Linear with all your changes:\n\n```bash\nttt sync --update\n```",
				);
			}
			if (baseName === "done-job" || baseName.endsWith("done-job")) {
				// Update description for local mode
				content = content.replace(
					/Mark a task as done and update Linear with commit details\./,
					"Mark a task as done locally. (Run `ttt sync --update` to push changes to Linear)",
				);
				// Add reminder at the end
				content = content.replace(
					/## What It Does\n\n- Linear issue status → "Done"/,
					"## What It Does\n\n- Local status → `completed`",
				);
				content += `\n## Sync to Linear\n\nAfter completing tasks, push all changes to Linear:\n\n\`\`\`bash\nttt sync --update\n\`\`\`\n`;
			}
		}

		await fs.writeFile(destPath, content, "utf-8");
		console.log(`  ✓ .claude/commands/${newFileName}`);
	}

	return { installed: true, prefix };
}

async function init() {
	const args = process.argv.slice(2);
	const options = parseArgs(args);
	const paths = getPaths();

	console.log("🚀 Linear-TOON Initialization\n");

	// Check existing files
	const configExists = await fileExists(paths.configPath);
	const localExists = await fileExists(paths.localPath);

	if ((configExists || localExists) && !options.force) {
		console.log("Existing configuration found:");
		if (configExists) console.log(`  ✓ ${paths.configPath}`);
		if (localExists) console.log(`  ✓ ${paths.localPath}`);

		if (options.interactive) {
			const { proceed } = await prompts({
				type: "confirm",
				name: "proceed",
				message: "Update existing configuration?",
				initial: true,
			});
			if (!proceed) {
				console.log("Cancelled.");
				process.exit(0);
			}
		} else {
			console.log("Use --force to overwrite existing files.");
			process.exit(1);
		}
	}

	// Get API key
	const apiKey = await promptForApiKey(options);
	if (!apiKey) {
		console.error("Error: LINEAR_API_KEY is required.");
		console.error("Get your API key from: https://linear.app/settings/api");
		process.exit(1);
	}

	// Create Linear client
	const client = getLinearClient();

	console.log("\n📡 Fetching data from Linear...");

	// Fetch teams
	const teamsData = await client.teams();
	const teams = teamsData.nodes as LinearTeam[];

	if (teams.length === 0) {
		console.error("Error: No teams found in your Linear workspace.");
		process.exit(1);
	}

	// Select teams
	const { selected: selectedTeams, primary: primaryTeam } = await selectTeams(
		teams,
		options,
	);
	console.log(`  Teams: ${selectedTeams.map((t) => t.name).join(", ")}`);
	if (selectedTeams.length > 1) {
		console.log(`  Primary: ${primaryTeam.name}`);
	}

	// Fetch data from primary team
	const selectedTeam = await client.team(primaryTeam.id);
	const members = await selectedTeam.members();
	const users = members.nodes as LinearUser[];
	console.log(`  Users: ${users.length}`);

	const labelsData = await client.issueLabels({
		filter: { team: { id: { eq: primaryTeam.id } } },
	});
	const labels = labelsData.nodes as LinearLabel[];
	console.log(`  Labels: ${labels.length}`);

	const statesData = await client.workflowStates({
		filter: { team: { id: { eq: primaryTeam.id } } },
	});
	const states = statesData.nodes as LinearState[];

	const currentCycle = (await selectedTeam.activeCycle) as LinearCycle | null;

	// User selections
	const currentUser = await selectUser(users, options);
	const defaultLabel = await selectLabelFilter(labels, options);
	const statusSource = await selectStatusSource(options);
	const qaPmTeam = await selectQaPmTeam(teams, primaryTeam, options);
	const statusTransitions = await selectStatusMappings(states, options);

	// Build config
	const config = buildConfig(
		teams,
		users,
		labels,
		states,
		statusTransitions,
		currentCycle ?? undefined,
	);

	// Find keys
	const currentUserKey = findUserKey(config.users, currentUser.id);
	const primaryTeamKey = findTeamKey(config.teams, primaryTeam.id);
	const selectedTeamKeys = selectedTeams
		.map((team) => findTeamKey(config.teams, team.id))
		.filter((key): key is string => key !== undefined);
	const qaPmTeamKey = qaPmTeam
		? findTeamKey(config.teams, qaPmTeam.id)
		: undefined;

	const localConfig = buildLocalConfig(
		currentUserKey,
		primaryTeamKey,
		selectedTeamKeys,
		defaultLabel,
		undefined, // excludeLabels
		statusSource,
		qaPmTeamKey,
	);

	// Write config files
	console.log("\n📝 Writing configuration files...");
	await fs.mkdir(paths.baseDir, { recursive: true });

	// Merge with existing config if exists
	if (configExists && !options.force) {
		try {
			const existingContent = await fs.readFile(paths.configPath, "utf-8");
			const existingConfig = decode(existingContent) as unknown as Config;

			if (existingConfig.cycle_history) {
				config.cycle_history = existingConfig.cycle_history;
			}
			if (!currentCycle && existingConfig.current_cycle) {
				config.current_cycle = existingConfig.current_cycle;
			}
			if (existingConfig.priority_order) {
				config.priority_order = existingConfig.priority_order;
			}
		} catch {
			// Ignore merge errors
		}
	}

	await fs.writeFile(paths.configPath, encode(config), "utf-8");
	console.log(`  ✓ ${paths.configPath}`);

	// Merge local config
	if (localExists && !options.force) {
		try {
			const existingContent = await fs.readFile(paths.localPath, "utf-8");
			const existingLocal = decode(existingContent) as unknown as LocalConfig;

			if (!options.interactive) {
				if (existingLocal.current_user)
					localConfig.current_user = existingLocal.current_user;
				if (existingLocal.team) localConfig.team = existingLocal.team;
				if (existingLocal.teams) localConfig.teams = existingLocal.teams;
				if (existingLocal.qa_pm_team)
					localConfig.qa_pm_team = existingLocal.qa_pm_team;
				if (existingLocal.label) localConfig.label = existingLocal.label;
				if (existingLocal.exclude_labels)
					localConfig.exclude_labels = existingLocal.exclude_labels;
				if (existingLocal.status_source)
					localConfig.status_source = existingLocal.status_source;
			}
		} catch {
			// Ignore merge errors
		}
	}

	await fs.writeFile(paths.localPath, encode(localConfig), "utf-8");
	console.log(`  ✓ ${paths.localPath}`);

	// Update .gitignore
	const tttDir = paths.baseDir.replace(/^\.\//, "");
	await updateGitignore(tttDir, options.interactive ?? true);

	// Install Claude Code commands
	const { installed: commandsInstalled, prefix: commandPrefix } =
		await installClaudeCommands(options.interactive ?? true, statusSource);

	// Summary
	console.log("\n✅ Initialization complete!\n");
	console.log("Configuration summary:");
	console.log(`  Teams: ${selectedTeams.map((t) => t.name).join(", ")}`);
	if (selectedTeams.length > 1) {
		console.log(`  Primary team: ${primaryTeam.name}`);
	}
	console.log(
		`  User: ${currentUser.displayName || currentUser.name} (${currentUser.email})`,
	);
	console.log(`  Label filter: ${defaultLabel || "(none)"}`);
	console.log(
		`  Status source: ${statusSource === "local" ? "local (use 'sync --update' to push)" : "remote (immediate sync)"}`,
	);
	if (qaPmTeam) {
		console.log(`  QA/PM team: ${qaPmTeam.name}`);
	}
	console.log(`  (Use 'ttt config filters' to set excluded labels/users)`);
	if (currentCycle) {
		console.log(
			`  Cycle: ${currentCycle.name || `Cycle #${currentCycle.number}`}`,
		);
	}
	console.log(`  Status mappings:`);
	console.log(`    Todo: ${statusTransitions.todo}`);
	console.log(`    In Progress: ${statusTransitions.in_progress}`);
	console.log(`    Done: ${statusTransitions.done}`);
	if (statusTransitions.testing) {
		console.log(`    Testing: ${statusTransitions.testing}`);
	}
	if (statusTransitions.blocked) {
		console.log(`    Blocked: ${statusTransitions.blocked}`);
	}

	if (commandsInstalled) {
		const cmdPrefix = commandPrefix ? `${commandPrefix}` : "";
		console.log(
			`  Claude commands: /${cmdPrefix}work-on, /${cmdPrefix}done-job, /${cmdPrefix}sync-linear`,
		);
	}

	console.log("\nNext steps:");
	console.log("  1. Set LINEAR_API_KEY in your shell profile:");
	console.log(`     export LINEAR_API_KEY="${apiKey}"`);
	console.log("  2. Run sync: ttt sync");
	if (commandsInstalled) {
		const cmdPrefix = commandPrefix ? `${commandPrefix}` : "";
		console.log(`  3. In Claude Code: /${cmdPrefix}work-on next`);
	} else {
		console.log("  3. Start working: ttt work-on");
	}
}

init().catch(console.error);
