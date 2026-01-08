import {
	type Attachment,
	type Comment,
	type CycleData,
	type CycleInfo,
	getLinearClient,
	getPaths,
	getPrioritySortIndex,
	getTeamId,
	loadConfig,
	loadCycleData,
	loadLocalConfig,
	saveConfig,
	saveCycleData,
	type Task,
} from "./utils.js";
import {
	clearIssueImages,
	downloadLinearImage,
	ensureOutputDir,
	extractLinearImageUrls,
	isLinearImageUrl,
} from "./lib/images.js";

async function sync() {
	const args = process.argv.slice(2);

	// Handle help flag
	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt sync [issue-id] [--update]

Sync issues from Linear to local cycle.ttt file.

Arguments:
  issue-id    Optional. Sync only this specific issue (e.g., MP-624)

Options:
  --update    Push local status changes to Linear (for local mode users)
              This updates Linear with your local in-progress/completed statuses

What it does:
  - Fetches active cycle from Linear
  - Downloads all issues matching configured filters
  - Preserves local status for existing tasks
  - Updates config with new cycle info

Examples:
  ttt sync              # Sync all matching issues
  ttt sync MP-624       # Sync only this specific issue
  ttt sync --update     # Push local changes to Linear, then sync
  ttt sync -d .ttt     # Sync using .ttt directory`);
		process.exit(0);
	}

	// Check for --update flag
	const shouldUpdate = args.includes("--update");

	// Parse issue ID argument (if provided)
	const singleIssueId = args.find(
		(arg) => !arg.startsWith("-") && arg.match(/^[A-Z]+-\d+$/i),
	);

	const config = await loadConfig();
	const localConfig = await loadLocalConfig();
	const client = getLinearClient();
	const teamId = getTeamId(config, localConfig.team);
	const { outputPath } = getPaths();

	// Ensure output directory exists
	await ensureOutputDir(outputPath);

	// Build excluded labels set
	const excludedLabels = new Set(localConfig.exclude_labels ?? []);

	// Phase 1: Fetch active cycle directly from team
	console.log("Fetching latest cycle...");
	const team = await client.team(teamId);
	const activeCycle = await team.activeCycle;

	if (!activeCycle) {
		console.error("No active cycle found.");
		process.exit(1);
	}

	const cycleId = activeCycle.id;
	const cycleName = activeCycle.name ?? `Cycle #${activeCycle.number}`;
	const newCycleInfo: CycleInfo = {
		id: cycleId,
		name: cycleName,
		start_date: activeCycle.startsAt?.toISOString().split("T")[0] ?? "",
		end_date: activeCycle.endsAt?.toISOString().split("T")[0] ?? "",
	};

	// Check if cycle changed and update config with history
	const existingData = await loadCycleData();
	const oldCycleId = config.current_cycle?.id ?? existingData?.cycleId;

	if (oldCycleId && oldCycleId !== cycleId) {
		const oldCycleName =
			config.current_cycle?.name ?? existingData?.cycleName ?? "Unknown";
		console.log(`Cycle changed: ${oldCycleName} → ${cycleName}`);

		// Move old cycle to history (avoid duplicates)
		if (config.current_cycle) {
			config.cycle_history = config.cycle_history ?? [];
			// Remove if already exists in history
			config.cycle_history = config.cycle_history.filter(
				(c) => c.id !== config.current_cycle?.id,
			);
			config.cycle_history.unshift(config.current_cycle);
			// Keep only last 10 cycles
			if (config.cycle_history.length > 10) {
				config.cycle_history = config.cycle_history.slice(0, 10);
			}
		}

		// Update current cycle
		config.current_cycle = newCycleInfo;
		await saveConfig(config);
		console.log("Config updated with new cycle (old cycle saved to history).");
	} else {
		// Update current cycle info even if ID unchanged (dates might change)
		if (!config.current_cycle || config.current_cycle.id !== cycleId) {
			config.current_cycle = newCycleInfo;
			await saveConfig(config);
		}
		console.log(`Current cycle: ${cycleName}`);
	}

	// Phase 2: Fetch workflow states and get status mappings
	const workflowStates = await client.workflowStates({
		filter: { team: { id: { eq: teamId } } },
	});
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
					await client.updateIssue(task.linearId, { stateId: targetStateId });
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
	const filterLabel = localConfig.label;
	const syncStatuses = [statusTransitions.todo, statusTransitions.in_progress];

	let issues: { nodes: Array<{ id: string; identifier: string }> };

	if (singleIssueId) {
		// Sync single issue by ID
		console.log(`Fetching issue ${singleIssueId}...`);
		const searchResult = await client.searchIssues(singleIssueId);
		const matchingIssue = searchResult.nodes.find(
			(i) => i.identifier === singleIssueId,
		);

		if (!matchingIssue) {
			console.error(`Issue ${singleIssueId} not found.`);
			process.exit(1);
		}

		issues = { nodes: [matchingIssue] };
	} else {
		// Sync all matching issues
		console.log(
			`Fetching issues with status: ${syncStatuses.join(", ")}${filterLabel ? ` and label: ${filterLabel}` : ""}...`,
		);

		// Build filter - label is optional
		const issueFilter: Record<string, unknown> = {
			team: { id: { eq: teamId } },
			cycle: { id: { eq: cycleId } },
			state: { name: { in: syncStatuses } },
		};
		if (filterLabel) {
			issueFilter.labels = { name: { eq: filterLabel } };
		}

		issues = await client.issues({
			filter: issueFilter,
			first: 50,
		});
	}

	if (issues.nodes.length === 0) {
		console.log(
			`No issues found in current cycle with ${syncStatuses.join("/")} status${filterLabel ? ` and label: ${filterLabel}` : ""}.`,
		);
	}

	const tasks: Task[] = [];
	let updatedCount = 0;

	for (const issueNode of issues.nodes) {
		// Fetch full issue to get all relations (searchIssues returns IssueSearchResult which lacks some methods)
		const issue = await client.issue(issueNode.id);

		const assignee = await issue.assignee;
		const assigneeEmail = assignee?.email;

		const labels = await issue.labels();
		const labelNames = labels.nodes.map((l: { name: string }) => l.name);

		// Skip if any label is in excluded list
		if (labelNames.some((name: string) => excludedLabels.has(name))) {
			continue;
		}

		const state = await issue.state;
		const parent = await issue.parent;
		const attachmentsData = await issue.attachments();
		const commentsData = await issue.comments();

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

		// Extract and download images from description
		if (issue.description) {
			const descriptionImageUrls = extractLinearImageUrls(issue.description);
			for (const url of descriptionImageUrls) {
				// Generate a short ID from URL (last segment of path)
				const urlPath = new URL(url).pathname;
				const segments = urlPath.split("/").filter(Boolean);
				const imageId = segments[segments.length - 1] || `desc_${Date.now()}`;

				// Skip if already in attachments
				if (attachments.some((a) => a.url === url)) continue;

				const localPath = await downloadLinearImage(
					url,
					issue.identifier,
					imageId,
					outputPath,
				);

				if (localPath) {
					attachments.push({
						id: imageId,
						title: `Description Image`,
						url: url,
						sourceType: "description",
						localPath: localPath,
					});
				}
			}
		}

		// Build comments list
		const comments: Comment[] = await Promise.all(
			commentsData.nodes.map(async (c) => {
				const user = await c.user;
				return {
					id: c.id,
					body: c.body,
					createdAt: c.createdAt.toISOString(),
					user: user?.displayName ?? user?.email,
				};
			}),
		);

		let localStatus: Task["localStatus"] = "pending";

		// Preserve local status & sync completed tasks to Linear
		if (existingTasksMap.has(issue.identifier)) {
			const existing = existingTasksMap.get(issue.identifier);
			localStatus = existing?.localStatus ?? "pending";

			if (localStatus === "completed" && state && testingStateId) {
				// Skip if already in terminal states (done, testing, or cancelled type)
				const terminalStates = [statusTransitions.done];
				if (statusTransitions.testing)
					terminalStates.push(statusTransitions.testing);
				const isTerminal =
					terminalStates.includes(state.name) || state.type === "cancelled";

				if (!isTerminal) {
					console.log(
						`Updating ${issue.identifier} to ${statusTransitions.testing} in Linear...`,
					);
					await client.updateIssue(issue.id, { stateId: testingStateId });
					updatedCount++;
				}
			}
		}

		const task: Task = {
			id: issue.identifier,
			linearId: issue.id,
			title: issue.title,
			status: state ? state.name : "Unknown",
			localStatus: localStatus,
			assignee: assigneeEmail,
			priority: issue.priority,
			labels: labelNames,
			branch: issue.branchName,
			description: issue.description ?? undefined,
			parentIssueId: parent ? parent.identifier : undefined,
			url: issue.url,
			attachments: attachments.length > 0 ? attachments : undefined,
			comments: comments.length > 0 ? comments : undefined,
		};

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
		cycleId: cycleId,
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

sync().catch(console.error);
