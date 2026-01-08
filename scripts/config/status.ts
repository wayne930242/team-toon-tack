import prompts from "prompts";
import { getWorkflowStates } from "../lib/linear.js";
import {
	type Config,
	type LocalConfig,
	saveConfig,
	type StatusTransitions,
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
		title: `${s.name} (${s.type})`,
		value: s.name,
	}));

	// Get current values or defaults
	const current = config.status_transitions || ({} as StatusTransitions);
	const defaultTodo =
		current.todo || states.find((s) => s.type === "unstarted")?.name || "Todo";
	const defaultInProgress =
		current.in_progress ||
		states.find((s) => s.type === "started")?.name ||
		"In Progress";
	const defaultDone =
		current.done || states.find((s) => s.type === "completed")?.name || "Done";
	const defaultTesting =
		current.testing || states.find((s) => s.name === "Testing")?.name;

	const todoResponse = await prompts({
		type: "select",
		name: "todo",
		message: 'Select status for "Todo" (pending tasks):',
		choices: stateChoices,
		initial: stateChoices.findIndex((c) => c.value === defaultTodo),
	});

	const inProgressResponse = await prompts({
		type: "select",
		name: "in_progress",
		message: 'Select status for "In Progress" (working tasks):',
		choices: stateChoices,
		initial: stateChoices.findIndex((c) => c.value === defaultInProgress),
	});

	const doneResponse = await prompts({
		type: "select",
		name: "done",
		message: 'Select status for "Done" (completed tasks):',
		choices: stateChoices,
		initial: stateChoices.findIndex((c) => c.value === defaultDone),
	});

	// Testing is optional
	const testingChoices = [
		{ title: "(None)", value: undefined },
		...stateChoices,
	];
	const testingResponse = await prompts({
		type: "select",
		name: "testing",
		message: 'Select status for "Testing" (optional, for parent tasks):',
		choices: testingChoices,
		initial: defaultTesting
			? testingChoices.findIndex((c) => c.value === defaultTesting)
			: 0,
	});

	const statusTransitions: StatusTransitions = {
		todo: todoResponse.todo || defaultTodo,
		in_progress: inProgressResponse.in_progress || defaultInProgress,
		done: doneResponse.done || defaultDone,
		testing: testingResponse.testing,
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
