import { afterEach, beforeEach, test } from "bun:test";
import assert from "node:assert/strict";
import type { Config, LocalConfig, Task } from "../../utils.js";
import {
	type CompletionDeps,
	handleUpstreamCompletion,
} from "./linear-handler.js";
import type { CompletionContext, ParentUpdateResult } from "./types.js";

const config = {
	teams: {},
	users: {},
	status_transitions: {
		todo: "Todo",
		in_progress: "In Progress",
		done: "Done",
		testing: "Testing",
	},
} as unknown as Config;

function context(
	task: Partial<Task>,
	localConfig: Partial<LocalConfig>,
): CompletionContext {
	return {
		task: {
			id: "MP-1",
			linearId: "uuid-1",
			status: "In Progress",
			...task,
		} as Task,
		config,
		localConfig: {
			team: "dev",
			dev_testing_status: "Testing",
			...localConfig,
		} as LocalConfig,
		commit: null,
		promptMessage: "",
	};
}

function fakeDeps(parent: ParentUpdateResult = { success: false }) {
	const writes: string[] = [];
	const deps: CompletionDeps = {
		updateIssueStatus: async (_id, status) => {
			writes.push(status);
			return true;
		},
		updateParentToTesting: async () => parent,
	};
	return { deps, writes };
}

const qaPm = [{ team: "pm", testing_status: "Testing" }];

let logs: string[] = [];
const realLog = console.log;
beforeEach(() => {
	logs = [];
	console.log = (...args: unknown[]) => void logs.push(args.join(" "));
});
afterEach(() => {
	console.log = realLog;
});

test("upstream_strict without a parent goes straight to testing, never writing Done first", async () => {
	const { deps, writes } = fakeDeps();

	const result = await handleUpstreamCompletion(
		context({}, { qa_pm_teams: qaPm }),
		true,
		deps,
	);

	assert.deepEqual(writes, ["Testing"]);
	assert.deepEqual(result, { success: true, status: "Testing" });
	assert.match(logs.join("\n"), /no parent issue/);
	assert.match(logs.join("\n"), /upstream_not_strict/);
});

test("upstream_strict with a parent that cannot move falls back and explains the rule", async () => {
	const { deps, writes } = fakeDeps({ success: false });

	const result = await handleUpstreamCompletion(
		context({ parentIssueId: "PM-9" }, { qa_pm_teams: qaPm }),
		true,
		deps,
	);

	assert.deepEqual(writes, ["Done", "Testing"]);
	assert.equal(result.status, "Testing");
	const output = logs.join("\n");
	assert.match(output, /fallback: parent PM-9 could not be moved to testing/);
	assert.match(output, /upstream_strict/);
});

test("upstream_strict keeps Done when the parent moves to testing", async () => {
	const { deps, writes } = fakeDeps({
		success: true,
		testingStatus: "Testing",
	});

	const result = await handleUpstreamCompletion(
		context({ parentIssueId: "PM-9" }, { qa_pm_teams: qaPm }),
		true,
		deps,
	);

	assert.deepEqual(writes, ["Done"]);
	assert.deepEqual(result, { success: true, status: "Done" });
});

test("upstream_not_strict without a parent still ends in Done", async () => {
	const { deps, writes } = fakeDeps();

	const result = await handleUpstreamCompletion(
		context({}, { qa_pm_teams: qaPm }),
		false,
		deps,
	);

	assert.deepEqual(writes, ["Done"]);
	assert.deepEqual(result, { success: true, status: "Done" });
});
