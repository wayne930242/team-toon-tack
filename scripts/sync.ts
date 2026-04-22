import { createAdapter } from "./lib/adapters/index.js";
import {
	clearAllOutput,
	clearIssueImages,
	downloadLinearImage,
	downloadTrelloFile,
	ensureOutputDir,
	extractImageUrls,
	isLinearImageUrl,
} from "./lib/files.js";
import {
	getReviewStatuses,
	getSyncStatuses,
	resolveLocalStatus,
} from "./lib/status-helpers.js";
import {
	type Attachment,
	type Comment,
	type Config,
	type CycleData,
	type CycleInfo,
	getLinearClient,
	getPaths,
	getPrioritySortIndex,
	getSourceType,
	getTeamId,
	type LocalConfig,
	loadConfig,
	loadCycleData,
	loadLocalConfig,
	preserveLocalTaskFields,
	saveConfig,
	saveCycleData,
	type Task,
	withRetry,
} from "./utils.js";

async function downloadEmbeddedImages(
	texts: Array<string | undefined>,
	issueId: string,
	attachments: Attachment[],
	outputDir: string,
	downloadFile: (
		url: string,
		issueId: string,
		attachmentId: string,
		outputDir: string,
	) => Promise<string | undefined>,
	titlePrefix: string,
	sourceType: string,
	filterUrl?: (url: string) => boolean,
): Promise<void> {
	let imageIndex = 0;

	for (const text of texts) {
		if (!text) continue;

		for (const url of extractImageUrls(text)) {
			if (filterUrl && !filterUrl(url)) continue;
			if (attachments.some((a) => a.url === url)) continue;

			const attachmentId = `${titlePrefix.toLowerCase()}_${imageIndex++}`;
			const localPath = await downloadFile(
				url,
				issueId,
				attachmentId,
				outputDir,
			);

			if (localPath) {
				attachments.push({
					id: attachmentId,
					title: `${titlePrefix} Image`,
					url,
					sourceType,
					localPath,
				});
			}
		}
	}
}

async function sync() {
	const args = process.argv.slice(2);

	// Handle help flag
	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt sync [issue-id] [--all] [--update]

Sync issues from Linear to local cycle.ttt file.

Arguments:
  issue-id    Optional. Sync only this specific issue (e.g., MP-624)

Options:
  --all       Sync all issues regardless of status (default: only Todo/In Progress)
  --update    Push local status changes to Linear (for local mode users)
              This updates Linear with your local in-progress/completed statuses

What it does:
  - Fetches active cycle from Linear
  - Downloads issues with Todo/In Progress status (or all with --all)
  - Filters by label if configured
  - Preserves local status for existing tasks
  - Updates config with new cycle info

Examples:
  ttt sync              # Sync Todo/In Progress issues
  ttt sync --all        # Sync all issues regardless of status
  ttt sync MP-624       # Sync only this specific issue
  ttt sync --update     # Push local changes to Linear, then sync`);
		process.exit(0);
	}

	// Check for flags
	const shouldUpdate = args.includes("--update");
	const syncAll = args.includes("--all");

	// Parse issue ID argument (if provided)
	const singleIssueId = args.find(
		(arg) => !arg.startsWith("-") && arg.match(/^[A-Z]+-\d+$/i),
	);

	const config = await loadConfig();
	const localConfig = await loadLocalConfig();
	const { outputPath } = getPaths();

	// Check source type and branch
	const sourceType = getSourceType(config);
	if (sourceType === "trello") {
		await syncTrello(config, localConfig, {
			shouldUpdate,
			syncAll,
			singleIssueId,
			outputPath,
		});
		return;
	}

	// === Linear sync (default) ===
	const client = getLinearClient();
	const teamId = getTeamId(config, localConfig.team);

	// Ensure output directory exists
	await ensureOutputDir(outputPath);

	// Clear previous output for full sync (not single-issue)
	if (!singleIssueId) {
		await clearAllOutput(outputPath);
	}

	// Build excluded labels set
	const excludedLabels = new Set(localConfig.exclude_labels ?? []);

	// Phase 1: Fetch active cycle directly from team (if the team uses cycles)
	console.log("Fetching latest cycle...");
	const team = await withRetry(() => client.team(teamId), {
		label: "fetch team",
	});
	const activeCycle = await withRetry(
		async () => team.activeCycle ?? undefined,
		{ label: "fetch active cycle" },
	);

	let cycleId: string | undefined;
	let cycleName: string;

	const existingData = await loadCycleData();

	if (activeCycle) {
		cycleId = activeCycle.id;
		cycleName = activeCycle.name ?? `Cycle #${activeCycle.number}`;
		const newCycleInfo: CycleInfo = {
			id: cycleId,
			name: cycleName,
			start_date: activeCycle.startsAt?.toISOString().split("T")[0] ?? "",
			end_date: activeCycle.endsAt?.toISOString().split("T")[0] ?? "",
		};

		const oldCycleId = config.current_cycle?.id ?? existingData?.cycleId;

		if (oldCycleId && oldCycleId !== cycleId) {
			const oldCycleName =
				config.current_cycle?.name ?? existingData?.cycleName ?? "Unknown";
			console.log(`Cycle changed: ${oldCycleName} → ${cycleName}`);

			if (config.current_cycle) {
				config.cycle_history = config.cycle_history ?? [];
				config.cycle_history = config.cycle_history.filter(
					(c) => c.id !== config.current_cycle?.id,
				);
				config.cycle_history.unshift(config.current_cycle);
				if (config.cycle_history.length > 10) {
					config.cycle_history = config.cycle_history.slice(0, 10);
				}
			}

			config.current_cycle = newCycleInfo;
			await saveConfig(config);
			console.log(
				"Config updated with new cycle (old cycle saved to history).",
			);
		} else {
			if (!config.current_cycle || config.current_cycle.id !== cycleId) {
				config.current_cycle = newCycleInfo;
				await saveConfig(config);
			}
			console.log(`Current cycle: ${cycleName}`);
		}
	} else {
		cycleName = "No Cycle";
		console.log("No active cycle on this team — syncing without cycle filter.");
	}

	// Phase 2: Fetch workflow states and get status mappings
	const workflowStates = await withRetry(
		() =>
			client.workflowStates({
				filter: { team: { id: { eq: teamId } } },
			}),
		{ label: "fetch workflow states" },
	);
	const stateMap = new Map(workflowStates.nodes.map((s) => [s.name, s.id]));

	// Get status names from config or use defaults
	const statusTransitions = config.status_transitions || {
		todo: "Todo",
		in_progress: "In Progress",
		done: "Done",
		testing: "Testing",
	};
	const testingStateId = statusTransitions.testing
		? stateMap.get(statusTransitions.testing)
		: undefined;
	const inProgressStateId = stateMap.get(statusTransitions.in_progress);

	// Phase 2.5: Push local status changes to Linear (if --update flag)
	if (shouldUpdate && existingData) {
		console.log("Pushing local status changes to Linear...");
		let pushCount = 0;

		for (const task of existingData.tasks) {
			// Map local status to Linear status
			let targetStateId: string | undefined;

			if (task.localStatus === "in-progress" && inProgressStateId) {
				// Check if Linear status is not already in-progress
				if (task.status !== statusTransitions.in_progress) {
					targetStateId = inProgressStateId;
				}
			} else if (task.localStatus === "completed" && testingStateId) {
				// Check if Linear status is not already testing/done
				const terminalStatuses = [statusTransitions.done];
				if (statusTransitions.testing)
					terminalStatuses.push(statusTransitions.testing);
				if (!terminalStatuses.includes(task.status)) {
					targetStateId = testingStateId;
				}
			}

			if (targetStateId) {
				try {
					const payload = await withRetry(
						() =>
							client.updateIssue(task.linearId, {
								stateId: targetStateId,
							}),
						{ label: `update ${task.id}` },
					);
					if (!payload.success) {
						throw new Error("Linear mutation returned success=false");
					}
					const targetName =
						targetStateId === inProgressStateId
							? statusTransitions.in_progress
							: statusTransitions.testing;
					console.log(`  ${task.id} → ${targetName}`);
					pushCount++;
				} catch (e) {
					console.error(`  Failed to update ${task.id}:`, e);
				}
			}
		}

		if (pushCount > 0) {
			console.log(`Pushed ${pushCount} status updates to Linear.`);
		} else {
			console.log("No local changes to push.");
		}
	}

	// Phase 3: Build existing tasks map for preserving local status
	const existingTasksMap = new Map(existingData?.tasks.map((t) => [t.id, t]));

	// Phase 4: Fetch current issues with full content
	const filterLabels = localConfig.labels;
	const syncStatuses = getSyncStatuses(statusTransitions);
	const labelDesc =
		filterLabels && filterLabels.length > 0
			? ` with labels: ${filterLabels.join(", ")}`
			: "";

	let issues: { nodes: Array<{ id: string; identifier: string }> };

	if (singleIssueId) {
		// Sync single issue by ID
		console.log(`Fetching issue ${singleIssueId}...`);
		const searchResult = await withRetry(
			() => client.searchIssues(singleIssueId),
			{ label: `search ${singleIssueId}` },
		);
		const matchingIssue = searchResult.nodes.find(
			(i) => i.identifier === singleIssueId,
		);

		if (!matchingIssue) {
			console.error(`Issue ${singleIssueId} not found.`);
			process.exit(1);
		}

		issues = { nodes: [matchingIssue] };
	} else {
		// Build status filter description
		const statusDesc = syncAll
			? "all statuses"
			: `${syncStatuses.join("/")} status`;
		console.log(`Fetching issues (${statusDesc})${labelDesc}...`);

		// Build filter - label is optional; cycle is skipped if team has no
		// active cycle (Linear lets teams disable cycles entirely).
		const issueFilter: Record<string, unknown> = {
			team: { id: { eq: teamId } },
		};
		if (cycleId) {
			issueFilter.cycle = { id: { eq: cycleId } };
		}
		if (!syncAll) {
			issueFilter.state = { name: { in: syncStatuses } };
		}
		if (filterLabels && filterLabels.length > 0) {
			issueFilter.labels = { name: { in: filterLabels } };
		}

		issues = await withRetry(
			() =>
				client.issues({
					filter: issueFilter,
					first: 50,
				}),
			{ label: "fetch issues" },
		);
	}

	if (issues.nodes.length === 0) {
		console.log(`No issues found in current cycle${labelDesc}.`);
	} else {
		console.log(`Found ${issues.nodes.length} issues. Processing...`);
	}

	const tasks: Task[] = [];
	let updatedCount = 0;
	const totalIssues = issues.nodes.length;
	let processedCount = 0;

	for (const issueNode of issues.nodes) {
		processedCount++;
		process.stdout.write(`\r  Processing ${processedCount}/${totalIssues}...`);

		// Fetch full issue to get all relations (searchIssues returns IssueSearchResult which lacks some methods)
		const issueLabel = issueNode.identifier;
		const issue = await withRetry(() => client.issue(issueNode.id), {
			label: `fetch ${issueLabel}`,
		});

		const assignee = await withRetry(() => Promise.resolve(issue.assignee), {
			label: `fetch ${issueLabel} assignee`,
		});
		const assigneeEmail = assignee?.email;

		const labels = await withRetry(() => issue.labels(), {
			label: `fetch ${issueLabel} labels`,
		});
		const labelNames = labels.nodes.map((l: { name: string }) => l.name);

		// Skip if any label is in excluded list
		if (labelNames.some((name: string) => excludedLabels.has(name))) {
			continue;
		}

		const state = await withRetry(() => Promise.resolve(issue.state), {
			label: `fetch ${issueLabel} state`,
		});
		const parent = await withRetry(() => Promise.resolve(issue.parent), {
			label: `fetch ${issueLabel} parent`,
		});
		const attachmentsData = await withRetry(() => issue.attachments(), {
			label: `fetch ${issueLabel} attachments`,
		});
		const commentsData = await withRetry(() => issue.comments(), {
			label: `fetch ${issueLabel} comments`,
		});

		// Clear old images for this issue before downloading new ones
		await clearIssueImages(outputPath, issue.identifier);

		// Build attachments list and download Linear images
		const attachments: Attachment[] = [];
		for (const a of attachmentsData.nodes as Array<{
			id: string;
			title: string;
			url: string;
			sourceType?: string | null;
		}>) {
			const attachment: Attachment = {
				id: a.id,
				title: a.title,
				url: a.url,
				sourceType: a.sourceType ?? undefined,
			};

			// Download Linear domain images
			if (isLinearImageUrl(a.url)) {
				const localPath = await downloadLinearImage(
					a.url,
					issue.identifier,
					a.id,
					outputPath,
				);
				if (localPath) {
					attachment.localPath = localPath;
				}
			}

			attachments.push(attachment);
		}

		// Build comments list
		const comments: Comment[] = await Promise.all(
			commentsData.nodes.map(async (c) => {
				const user = await withRetry(() => Promise.resolve(c.user), {
					label: `fetch ${issueLabel} comment user`,
				});
				return {
					id: c.id,
					body: c.body,
					createdAt: c.createdAt.toISOString(),
					user: user?.displayName ?? user?.email,
				};
			}),
		);

		await downloadEmbeddedImages(
			[
				issue.description ?? undefined,
				...comments
					.map((comment) => comment.body)
					.filter((body): body is string => Boolean(body)),
			],
			issue.identifier,
			attachments,
			outputPath,
			downloadLinearImage,
			"Embedded",
			"description",
			isLinearImageUrl,
		);

		let localStatus: Task["localStatus"] = "pending";

		// Preserve local status & sync completed tasks to Linear
		if (existingTasksMap.has(issue.identifier)) {
			const existing = existingTasksMap.get(issue.identifier);
			localStatus = resolveLocalStatus(
				existing?.localStatus,
				state?.name ?? "",
				statusTransitions,
				localConfig,
			);

			if (localStatus === "completed" && state && testingStateId) {
				// Skip if already in terminal states (done, testing, or cancelled type)
				const terminalStates = [
					statusTransitions.done,
					...getReviewStatuses(statusTransitions, localConfig),
				];
				const isTerminal =
					terminalStates.includes(state.name) || state.type === "cancelled";

				if (!isTerminal) {
					console.log(
						`Updating ${issue.identifier} to ${statusTransitions.testing} in Linear...`,
					);
					const payload = await withRetry(
						() =>
							client.updateIssue(issue.id, {
								stateId: testingStateId,
							}),
						{ label: `update ${issue.identifier}` },
					);
					if (!payload.success) {
						throw new Error("Linear mutation returned success=false");
					}
					updatedCount++;
				}
			}
		} else if (state) {
			localStatus = resolveLocalStatus(
				undefined,
				state.name,
				statusTransitions,
				localConfig,
			);
			if (state.type === "completed") {
				localStatus = "completed";
			}
		}

		const existingTask = existingTasksMap.get(issue.identifier);
		const task: Task = preserveLocalTaskFields(
			{
				id: issue.identifier,
				linearId: issue.id,
				title: issue.title,
				status: state ? state.name : "Unknown",
				localStatus: localStatus,
				assignee: assigneeEmail,
				priority: issue.priority,
				labels: labelNames,
				description: issue.description ?? undefined,
				parentIssueId: parent ? parent.identifier : undefined,
				url: issue.url,
				attachments: attachments.length > 0 ? attachments : undefined,
				comments: comments.length > 0 ? comments : undefined,
			},
			existingTask,
		);

		tasks.push(task);
	}

	// Sort by priority using config order
	tasks.sort((a, b) => {
		const pa = getPrioritySortIndex(a.priority, config.priority_order);
		const pb = getPrioritySortIndex(b.priority, config.priority_order);
		return pa - pb;
	});

	let finalTasks: Task[];

	if (singleIssueId && existingData) {
		// Merge single issue into existing tasks
		const existingTasks = existingData.tasks.filter(
			(t) => t.id !== singleIssueId,
		);
		finalTasks = [...existingTasks, ...tasks];
		// Re-sort after merge
		finalTasks.sort((a, b) => {
			const pa = getPrioritySortIndex(a.priority, config.priority_order);
			const pb = getPrioritySortIndex(b.priority, config.priority_order);
			return pa - pb;
		});
	} else {
		finalTasks = tasks;
	}

	const newData: CycleData = {
		cycleId: cycleId ?? `team:${teamId}`,
		cycleName: cycleName,
		updatedAt: new Date().toISOString(),
		tasks: finalTasks,
	};

	await saveCycleData(newData);

	if (singleIssueId) {
		console.log(`\n✅ Synced issue ${singleIssueId}.`);
	} else {
		console.log(`\n✅ Synced ${tasks.length} tasks for ${cycleName}.`);
	}
	if (updatedCount > 0) {
		console.log(
			`   Updated ${updatedCount} issues to ${statusTransitions.testing} in Linear.`,
		);
	}
}

// ============================================
// Trello Sync
// ============================================

interface TrelloSyncOptions {
	shouldUpdate: boolean;
	syncAll: boolean;
	singleIssueId?: string;
	outputPath: string;
}

async function syncTrello(
	config: Config,
	localConfig: LocalConfig,
	options: TrelloSyncOptions,
) {
	const { shouldUpdate, syncAll, singleIssueId, outputPath } = options;
	const trelloCredentials = {
		apiKey: config.source?.trello?.apiKey ?? process.env.TRELLO_API_KEY,
		token: config.source?.trello?.token ?? process.env.TRELLO_TOKEN,
	};
	const downloadTrelloAttachment = (
		url: string,
		issueId: string,
		attachmentId: string,
		outputDir: string,
	) =>
		downloadTrelloFile(
			url,
			issueId,
			attachmentId,
			outputDir,
			trelloCredentials,
		);

	// Create adapter
	const adapter = createAdapter(config);

	// Validate connection
	const isConnected = await adapter.validateConnection();
	if (!isConnected) {
		console.error("Error: Failed to connect to Trello.");
		console.error(
			"Check your TRELLO_API_KEY and TRELLO_TOKEN environment variables.",
		);
		process.exit(1);
	}

	// Ensure output directory exists
	await ensureOutputDir(outputPath);

	// Clear previous output for full sync (not single-issue)
	if (!singleIssueId) {
		await clearAllOutput(outputPath);
	}

	// Build excluded labels set
	const excludedLabels = new Set(localConfig.exclude_labels ?? []);

	// Get team (board) ID
	const teamId = config.teams[localConfig.team]?.id;
	if (!teamId) {
		console.error(`Error: Team "${localConfig.team}" not found in config.`);
		process.exit(1);
	}

	// Get status transitions
	const statusTransitions = config.status_transitions || {
		todo: "Todo",
		in_progress: "In Progress",
		done: "Done",
	};
	const syncStatuses = getSyncStatuses(statusTransitions);

	// Load existing data
	const existingData = await loadCycleData();
	const existingTasksMap = new Map(existingData?.tasks.map((t) => [t.id, t]));

	// Phase 1: Push local status changes if --update
	if (shouldUpdate && existingData) {
		console.log("Pushing local status changes to Trello...");
		let pushCount = 0;

		// Get statuses to find list IDs
		const statuses = await adapter.getStatuses(teamId);
		const statusIdMap = new Map(statuses.map((s) => [s.name, s.id]));

		for (const task of existingData.tasks) {
			let targetStatusName: string | undefined;

			if (task.localStatus === "in-progress") {
				if (task.status !== statusTransitions.in_progress) {
					targetStatusName = statusTransitions.in_progress;
				}
			} else if (task.localStatus === "completed") {
				if (task.status !== statusTransitions.done) {
					targetStatusName = statusTransitions.done;
				}
			}

			if (targetStatusName) {
				const targetStatusId = statusIdMap.get(targetStatusName);
				if (targetStatusId) {
					const result = await adapter.updateIssueStatus(
						task.sourceId ?? task.linearId,
						targetStatusId,
					);
					if (result.success) {
						console.log(`  ${task.id} → ${targetStatusName}`);
						pushCount++;
					} else {
						console.error(`  Failed to update ${task.id}: ${result.error}`);
					}
				}
			}
		}

		if (pushCount > 0) {
			console.log(`Pushed ${pushCount} status updates to Trello.`);
		} else {
			console.log("No local changes to push.");
		}
	}

	// Phase 2: Fetch issues
	const statusDesc = syncAll
		? "all statuses"
		: `${syncStatuses.join("/")} status`;
	const filterLabels = localConfig.labels;
	const labelDesc =
		filterLabels && filterLabels.length > 0
			? ` with labels: ${filterLabels.join(", ")}`
			: "";
	console.log(`Fetching cards (${statusDesc})${labelDesc}...`);

	let issues: Awaited<ReturnType<typeof adapter.getIssues>>;
	if (singleIssueId) {
		// Sync single issue
		console.log(`Fetching card ${singleIssueId}...`);
		const issue = await adapter.searchIssue(singleIssueId);
		issues = issue ? [issue] : [];
	} else {
		issues = await adapter.getIssues({
			teamId,
			statusNames: syncAll ? undefined : syncStatuses,
			labelNames: filterLabels,
			excludeLabels: localConfig.exclude_labels,
			limit: 100,
		});
	}

	if (issues.length === 0) {
		console.log(`No cards found${labelDesc}.`);
	} else {
		console.log(`Found ${issues.length} cards. Processing...`);
	}

	// Phase 3: Convert to tasks
	const tasks: Task[] = [];
	let processedCount = 0;
	const totalIssues = issues.length;

	for (const issue of issues) {
		processedCount++;
		process.stdout.write(`\r  Processing ${processedCount}/${totalIssues}...`);

		// Skip if any label is in excluded list
		if (issue.labels.some((name) => excludedLabels.has(name))) {
			continue;
		}

		// Fetch full issue details (comments, attachments) per card
		const fullIssue = await adapter.getIssue(issue.sourceId);
		const comments: Comment[] =
			fullIssue?.comments?.map((c) => ({
				id: c.id,
				body: c.body,
				createdAt: c.createdAt,
				user: c.user,
			})) ?? [];
		const attachments: Attachment[] =
			fullIssue?.attachments?.map((a) => ({
				id: a.id,
				title: a.title,
				url: a.url,
				sourceType: a.sourceType,
			})) ?? [];

		await clearIssueImages(outputPath, issue.id);

		for (const attachment of attachments) {
			const localPath = await downloadTrelloAttachment(
				attachment.url,
				issue.id,
				attachment.id,
				outputPath,
			);
			if (localPath) {
				attachment.localPath = localPath;
			}
		}

		await downloadEmbeddedImages(
			[
				fullIssue?.description ?? issue.description,
				...comments
					.map((comment) => comment.body)
					.filter((body): body is string => Boolean(body)),
			],
			issue.id,
			attachments,
			outputPath,
			downloadTrelloAttachment,
			"Trello",
			"trello",
		);

		// Preserve local status or infer from remote status
		let localStatus: Task["localStatus"] = "pending";
		if (existingTasksMap.has(issue.id)) {
			const existing = existingTasksMap.get(issue.id);
			localStatus = resolveLocalStatus(
				existing?.localStatus,
				issue.status,
				statusTransitions,
				localConfig,
			);
		} else {
			localStatus = resolveLocalStatus(
				undefined,
				issue.status,
				statusTransitions,
				localConfig,
			);
		}

		const existingTask = existingTasksMap.get(issue.id);
		const task: Task = preserveLocalTaskFields(
			{
				id: issue.id,
				linearId: issue.sourceId, // For backwards compatibility
				sourceId: issue.sourceId,
				sourceType: "trello",
				title: issue.title,
				status: issue.status,
				localStatus,
				assignee: issue.assigneeEmail,
				priority: issue.priority,
				labels: issue.labels,
				description: issue.description,
				parentIssueId: issue.parentIssueId,
				url: issue.url,
				attachments: attachments.length > 0 ? attachments : undefined,
				comments: comments.length > 0 ? comments : undefined,
			},
			existingTask,
		);

		tasks.push(task);
	}

	// Sort by priority
	tasks.sort((a, b) => {
		const pa = getPrioritySortIndex(a.priority, config.priority_order);
		const pb = getPrioritySortIndex(b.priority, config.priority_order);
		return pa - pb;
	});

	// Merge tasks
	let finalTasks: Task[];
	if (singleIssueId && existingData) {
		const existingTasks = existingData.tasks.filter(
			(t) => t.id !== singleIssueId,
		);
		finalTasks = [...existingTasks, ...tasks];
		finalTasks.sort((a, b) => {
			const pa = getPrioritySortIndex(a.priority, config.priority_order);
			const pb = getPrioritySortIndex(b.priority, config.priority_order);
			return pa - pb;
		});
	} else {
		finalTasks = tasks;
	}

	// Save data (Trello has no cycle, use board name)
	const boardName = config.teams[localConfig.team]?.name ?? "Board";
	const newData: CycleData = {
		cycleId: teamId,
		cycleName: boardName,
		updatedAt: new Date().toISOString(),
		tasks: finalTasks,
	};

	await saveCycleData(newData);

	if (singleIssueId) {
		console.log(`\n✅ Synced card ${singleIssueId}.`);
	} else {
		console.log(`\n✅ Synced ${tasks.length} cards from ${boardName}.`);
	}
}

sync().catch(console.error);
