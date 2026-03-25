#!/usr/bin/env bun
import { input, select } from "@inquirer/prompts";
import { loadCycleData, saveCycleData, type Task } from "./utils.js";

interface EstimateArgs {
	issueId?: string;
	hours?: number;
	note?: string;
	clear: boolean;
}

function parseEstimateArgs(args: string[]): EstimateArgs {
	const parsed: EstimateArgs = { clear: false };

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--note" || arg === "-n") {
			parsed.note = args[++i];
			continue;
		}
		if (arg === "--clear") {
			parsed.clear = true;
			continue;
		}
		if (arg.startsWith("-")) {
			continue;
		}

		if (!parsed.issueId && !/^\d+(\.\d+)?$/.test(arg)) {
			parsed.issueId = arg;
			continue;
		}

		if (parsed.hours === undefined) {
			const hours = Number(arg);
			if (!Number.isNaN(hours)) {
				parsed.hours = hours;
			}
		}
	}

	return parsed;
}

function findTask(tasks: Task[], issueId?: string): Task | undefined {
	if (issueId) {
		return tasks.find((task) => task.id === issueId || task.id === `MP-${issueId}`);
	}

	const inProgressTasks = tasks.filter((task) => task.localStatus === "in-progress");
	if (inProgressTasks.length === 1) {
		return inProgressTasks[0];
	}

	return undefined;
}

async function resolveTask(tasks: Task[], issueId?: string): Promise<Task | undefined> {
	const directMatch = findTask(tasks, issueId);
	if (directMatch) {
		return directMatch;
	}

	if (issueId) {
		return undefined;
	}

	const inProgressTasks = tasks.filter((task) => task.localStatus === "in-progress");
	if (inProgressTasks.length === 0) {
		return undefined;
	}

	if (!process.stdin.isTTY) {
		return undefined;
	}

	const selectedId = await select({
		message: "選擇要寫入估時的任務:",
		choices: inProgressTasks.map((task) => ({
			name: `${task.id}: ${task.title}`,
			value: task.id,
			description: task.estimate
				? `目前 ${task.estimate.hours}h`
				: "尚未寫入 estimate",
		})),
	});

	return tasks.find((task) => task.id === selectedId);
}

async function resolveHours(hours?: number): Promise<number | undefined> {
	if (hours !== undefined) {
		return hours;
	}

	if (!process.stdin.isTTY) {
		return undefined;
	}

	const answer = await input({
		message: "預估工時（小時，可含小數）:",
	});
	const parsed = Number(answer);
	return Number.isNaN(parsed) ? undefined : parsed;
}

async function estimate() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt estimate [issue-id] [hours] [options]

Store a local human-effort estimate in cycle.toon.

Arguments:
  issue-id              Optional. Issue ID (e.g., MP-624). Defaults to current in-progress task.
  hours                 Estimated hours as a human engineer (supports decimals)

Options:
  -n, --note <text>     Short note or assumption summary
  --clear               Remove existing estimate from the task

Examples:
  ttt estimate MP-624 6
  ttt estimate 2.5
  ttt estimate MP-624 16 -n "backend contract pending"
  ttt estimate MP-624 --clear`);
		process.exit(0);
	}

	const { issueId, hours, note, clear } = parseEstimateArgs(args);
	const data = await loadCycleData();

	if (!data) {
		console.error("No cycle data found. Run ttt sync first.");
		process.exit(1);
	}

	const task = await resolveTask(data.tasks, issueId);
	if (!task) {
		console.error(
			issueId
				? `Issue ${issueId} not found in local data.`
				: "No in-progress task found. Specify issue ID explicitly.",
		);
		process.exit(1);
	}

	if (clear) {
		delete task.estimate;
		await saveCycleData(data);
		console.log(`Local: ${task.id} estimate cleared`);
		process.exit(0);
	}

	const resolvedHours = await resolveHours(hours);
	if (
		resolvedHours === undefined ||
		Number.isNaN(resolvedHours) ||
		resolvedHours <= 0
	) {
		console.error("Estimated hours must be a positive number.");
		process.exit(1);
	}

	task.estimate = {
		hours: resolvedHours,
		note: note || undefined,
		updatedAt: new Date().toISOString(),
	};

	await saveCycleData(data);
	const suffix = task.estimate.note ? ` (${task.estimate.note})` : "";
	console.log(`Local: ${task.id} estimate → ${task.estimate.hours}h${suffix}`);
}

estimate().catch(console.error);
