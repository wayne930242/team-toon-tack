import { select } from "@inquirer/prompts";
import { getWorkflowStates } from "../lib/linear.js";
import { getFirstTodoStatus } from "../lib/status-helpers.js";
import {
	type Config,
	type LocalConfig,
	type StatusTransitions,
	saveConfig,
} from "../utils.js";

export async function configureStatus(
	config: Config,
	localConfig: LocalConfig,
): Promise<void> {
	console.log("📊 Configure Status Mappings\n");

	const states = await getWorkflowStates(config, localConfig.team);

	if (states.length === 0) {
		console.error("No workflow states found for this team.");
		process.exit(1);
	}

	const stateChoices = states.map((s) => ({
		name: `${s.name} (${s.type})`,
		value: s.name,
	}));

	// Get current values or defaults
	const current = config.status_transitions || ({} as StatusTransitions);
	const defaultTodo =
		getFirstTodoStatus(current.todo) ||
		states.find((s) => s.type === "unstarted")?.name ||
		"Todo";
	const defaultInProgress =
		current.in_progress ||
		states.find((s) => s.type === "started")?.name ||
		"In Progress";
	const defaultDone =
		current.done || states.find((s) => s.type === "completed")?.name || "Done";
	const defaultTesting =
		current.testing || states.find((s) => s.name === "Testing")?.name;

	const todo = await select({
		message: 'Select status for "Todo" (pending tasks):',
		choices: stateChoices,
		default: defaultTodo,
	});

	const in_progress = await select({
		message: 'Select status for "In Progress" (working tasks):',
		choices: stateChoices,
		default: defaultInProgress,
	});

	const done = await select({
		message: 'Select status for "Done" (completed tasks):',
		choices: stateChoices,
		default: defaultDone,
	});

	// Testing is optional
	const testingChoices = [
		{ name: "(None)", value: undefined as string | undefined },
		...stateChoices,
	];
	const testing = await select<string | undefined>({
		message: 'Select status for "Testing" (optional, for parent tasks):',
		choices: testingChoices,
		default: defaultTesting,
	});

	const statusTransitions: StatusTransitions = {
		todo: todo || defaultTodo,
		in_progress: in_progress || defaultInProgress,
		done: done || defaultDone,
		testing: testing,
	};

	config.status_transitions = statusTransitions;
	await saveConfig(config);

	console.log("\n✅ Status mappings updated:");
	console.log(`  Todo: ${statusTransitions.todo}`);
	console.log(`  In Progress: ${statusTransitions.in_progress}`);
	console.log(`  Done: ${statusTransitions.done}`);
	if (statusTransitions.testing) {
		console.log(`  Testing: ${statusTransitions.testing}`);
	}
}
