import { describe, expect, test } from "bun:test";
import {
	DEFAULT_LOCAL_STATUSES,
	deriveTeamKey,
	normalizeTeamKey,
	parseStatusList,
	transitionsFor,
} from "./local-init.js";
import { TASK_SOURCE_CHOICES } from "./prompts.js";

describe("local init", () => {
	test("interactive init offers the local board as a source", () => {
		expect(TASK_SOURCE_CHOICES.map((c) => c.value)).toEqual([
			"linear",
			"trello",
			"local",
		]);
	});

	test("the default statuses are Linear's, with their state types", () => {
		const statuses = parseStatusList(DEFAULT_LOCAL_STATUSES);
		expect(statuses.map((s) => [s.id, s.name, s.type])).toEqual([
			["backlog", "Backlog", "backlog"],
			["todo", "Todo", "unstarted"],
			["in-progress", "In Progress", "started"],
			["in-review", "In Review", "started"],
			["done", "Done", "completed"],
			["canceled", "Canceled", "canceled"],
		]);
		expect(transitionsFor(statuses)).toEqual({
			todo: "Todo",
			in_progress: "In Progress",
			done: "Done",
			testing: "In Review",
		});
	});

	test("a status list without a started or done status is refused", () => {
		expect(() => parseStatusList("Todo, Done")).toThrow("started");
		expect(() => parseStatusList("Todo, Doing")).toThrow("completed");
		expect(() => parseStatusList("Todo, Todo:started, Done")).toThrow("twice");
	});

	test("team keys", () => {
		expect(normalizeTeamKey(" mp ")).toBe("MP");
		expect(() => normalizeTeamKey("M-P")).toThrow("team key");
		expect(deriveTeamKey("/work/web-app")).toBe("WEB");
		expect(deriveTeamKey("/tmp/123")).toBe("TTT");
	});
});
