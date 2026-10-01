import { test } from "bun:test";
import assert from "node:assert/strict";
import { resolveLabelIds } from "./create.js";
import type { SourceLabel } from "./lib/adapters/types.js";
import type { Config } from "./utils.js";

const config = {
	labels: {
		backend_v3: { id: "label-backend", name: "Backend-v3", color: "#eb5757" },
	},
} as unknown as Config;

const remoteLabels: SourceLabel[] = [
	{ id: "label-backend", name: "Backend-v3" },
	{ id: "label-bug", name: "Bug" },
];

let warnings: string[] = [];
const realError = console.error;
function captureWarnings() {
	warnings = [];
	console.error = (...args: unknown[]) => void warnings.push(args.join(" "));
}

test("labels known to config resolve without asking the source", async () => {
	let lookups = 0;

	const ids = await resolveLabelIds(config, "Backend-v3", async () => {
		lookups++;
		return remoteLabels;
	});

	assert.deepEqual(ids, ["label-backend"]);
	assert.equal(lookups, 0);
});

test("a label missing from config is resolved from the source by name", async () => {
	const ids = await resolveLabelIds(
		config,
		"Backend-v3,bug",
		async () => remoteLabels,
	);

	assert.deepEqual(ids, ["label-backend", "label-bug"]);
});

test("labels resolve from the source even when config has no labels at all", async () => {
	const ids = await resolveLabelIds(
		{} as Config,
		"Bug",
		async () => remoteLabels,
	);

	assert.deepEqual(ids, ["label-bug"]);
});

test("a label found nowhere is skipped with a warning that lists what exists", async () => {
	captureWarnings();
	try {
		const ids = await resolveLabelIds(
			config,
			"Backend-v3,Nope",
			async () => remoteLabels,
		);

		assert.deepEqual(ids, ["label-backend"]);
		const warning = warnings.join("\n");
		assert.match(warning, /label "Nope" not found in config or in the source/);
		assert.match(warning, /Backend-v3, Bug/);
	} finally {
		console.error = realError;
	}
});

test("a failing source lookup degrades to the config-only warning", async () => {
	captureWarnings();
	try {
		const ids = await resolveLabelIds(config, "Bug", async () => {
			throw new Error("network down");
		});

		assert.equal(ids, undefined);
		assert.match(warnings.join("\n"), /label "Bug" not found in config/);
	} finally {
		console.error = realError;
	}
});
