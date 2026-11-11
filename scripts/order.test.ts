import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { decode } from "@toon-format/toon";
import type { WorkOrder } from "./lib/order/types.js";
import {
	type LinearWorkspace,
	makeLinearWorkspace,
	readLocalStatuses,
	readRemote,
	runCli,
} from "./test-support/linear-workspace.js";

const today = (() => {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
})();
const ORDER = `app/${today}-a`;

function readOrder(workspace: LinearWorkspace, id = ORDER): WorkOrder {
	const file = path.join(workspace.dir, "orders", `${id}.toon`);
	return decode(readFileSync(file, "utf8"), {
		strict: false,
	}) as unknown as WorkOrder;
}

const order = (
	workspace: LinearWorkspace,
	args: string[],
	env: Record<string, string> = {},
	stdin?: string,
) => runCli(workspace, "order.ts", args, env, stdin);

const states = (o: WorkOrder) =>
	Object.fromEntries(o.tickets.map((t) => [t.id, t.state]));

/** Box workspace with MP-1..3 claimed into the order, MP-1 and MP-2 in review, sealed. */
async function sealedOnBox(
	issues: Record<string, { state: string; parent?: string }>,
): Promise<LinearWorkspace> {
	const box = makeLinearWorkspace(issues);
	const claimed = await runCli(box, "claim.ts", [
		"MP-1",
		"MP-2",
		"MP-3",
		"--order",
		"auto",
		"--project",
		"app",
	]);
	assert.equal(claimed.exitCode, 0, claimed.stderr);
	await order(box, ["review", ORDER, "MP-1", "MP-2"]);
	await order(box, ["drop", ORDER, "MP-3", "--reason", "not ready"]);
	const sealed = await order(box, ["seal", ORDER, "--gated-head", "5d6e7f8"]);
	assert.equal(sealed.exitCode, 0, sealed.stderr);
	return box;
}

const threeTodo = {
	"MP-1": { state: "s-todo" },
	"MP-2": { state: "s-todo" },
	"MP-3": { state: "s-todo" },
};

test("a work order carries a batch from claim on the box to Done on the Mac", async () => {
	const box = makeLinearWorkspace({
		"PM-9": { state: "s-progress" },
		"MP-1": { state: "s-todo", parent: "PM-9" },
		"MP-2": { state: "s-todo", parent: "PM-9" },
		"MP-3": { state: "s-todo" },
	});

	// Coordinator: claim into the project's open order
	const claimed = await runCli(box, "claim.ts", [
		"MP-1",
		"MP-2",
		"MP-3",
		"--order",
		"auto",
		"--project",
		"app",
	]);
	assert.equal(claimed.exitCode, 0, claimed.stderr);
	assert.match(
		claimed.stdout,
		new RegExp(`Order ${ORDER} \\(new\\): \\+ MP-1, MP-2, MP-3`),
	);
	assert.equal(readRemote(box)["MP-1"].status, "In Progress");
	assert.deepEqual(states(readOrder(box)), {
		"MP-1": "in-progress",
		"MP-2": "in-progress",
		"MP-3": "in-progress",
	});

	// Coordinator records what the workers report
	const set = await order(box, [
		"set",
		ORDER,
		"MP-1",
		"--branch",
		"feat/mp-1",
		"--mr",
		"!812",
		"--head",
		"1a2b3c4",
		"--review",
		"P0/P1=0",
		"--tests",
		"bun test scripts/x = pass",
		"--tests",
		"npm run lint @ 2b3c4d5 = pass",
	]);
	assert.equal(set.exitCode, 0, set.stderr);
	assert.deepEqual(
		readOrder(box).tickets[0].tests.map(
			(r) => `${r.command} @ ${r.sha} = ${r.result}`,
		),
		["bun test scripts/x @ 1a2b3c4 = pass", "npm run lint @ 2b3c4d5 = pass"],
	);

	// Review: the status moves, nothing else is sent
	const review = await order(box, ["review", ORDER, "MP-1", "MP-2"]);
	assert.equal(review.exitCode, 0, review.stderr);
	assert.equal(readRemote(box)["MP-2"].status, "In Review");
	assert.deepEqual(
		review.requests
			.filter((r) => r.name === "updateIssue")
			.map((r) => r.variables.input),
		[{ stateId: "s-review" }, { stateId: "s-review" }],
		"only the state changes, so the assignee stays",
	);
	assert.equal(readLocalStatuses(box)["MP-1"], "in-review");

	// Seal refuses while MP-3 is still in progress
	const early = await order(box, ["seal", ORDER, "--gated-head", "5d6e7f8"]);
	assert.equal(early.exitCode, 1);
	assert.match(early.stderr, /MP-3 still in progress/);
	await order(box, ["drop", ORDER, "MP-3", "--reason", "not ready"]);
	await order(box, [
		"train",
		ORDER,
		"--branch",
		`agent-train/${today}-a`,
		"--mr",
		"!900",
	]);
	const sealed = await order(box, ["seal", ORDER, "--gated-head", "5d6e7f8"]);
	assert.equal(sealed.exitCode, 0, sealed.stderr);

	// After the seal the next ticket opens the next order
	const late = await runCli(box, "claim.ts", ["MP-3", "--order", ORDER]);
	assert.equal(late.exitCode, 1);
	assert.match(late.stderr, /sealed and takes no more tickets/);

	// Hand off: the block goes into the train MR, the local copy is read-only
	const exported = await order(box, ["export", ORDER, "--handoff"]);
	assert.equal(exported.exitCode, 0, exported.stderr);
	assert.match(exported.stdout, /^```toon ttt-order\n/);
	const refused = await order(box, ["set", ORDER, "MP-1", "--mr", "!813"]);
	assert.equal(refused.exitCode, 1);
	assert.match(refused.stderr, /read-only.*ttt order reclaim/);
	assert.equal(readOrder(box).tickets[0].mr, "!812");

	// Integrator, on another machine, reads the block out of the MR text
	const mac = makeLinearWorkspace({}, { sameRemoteAs: box });
	const asMac = { TTT_ACTOR: "integ@mac" };
	const description = `## Train\n\n${exported.stdout}\n/cc @integ\n`;
	const imported = await order(mac, ["import", "-"], asMac, description);
	assert.equal(imported.exitCode, 0, imported.stderr);
	assert.equal(readOrder(mac).owner, "integ@mac");

	// Dry run: nothing moves, nothing is written
	const dry = await order(
		mac,
		["close", ORDER, "--merged", "9a8b7c6", "--version", "v1.2.0", "--dry-run"],
		asMac,
	);
	assert.equal(dry.exitCode, 0, dry.stderr);
	assert.match(dry.stdout, /MP-1 would complete \(now In Review\) and comment/);
	assert.equal(readOrder(mac).stage, "sealed");
	assert.equal(readRemote(mac)["MP-1"].status, "In Review");
	assert.equal(
		dry.requests.some((r) => /update|create/i.test(r.name)),
		false,
		"a dry run sends no mutation",
	);

	// Close with MP-2 refused: MP-1 is done, the order stays merged, exit 1
	const partial = await order(
		mac,
		["close", ORDER, "--merged", "9a8b7c6", "--version", "v1.2.0"],
		{ ...asMac, MOCK_LINEAR_FAIL_UPDATE: "MP-2" },
	);
	assert.equal(partial.exitCode, 1);
	assert.match(partial.stdout, /✅ MP-1 → Done/);
	assert.match(partial.stdout, /❌ MP-2 Failed to move MP-2 to Done/);
	assert.equal(readOrder(mac).stage, "merged");
	assert.equal(
		readRemote(mac)["PM-9"].status,
		"In Progress",
		"the parent waits for its other sub-issue",
	);

	// Rerun: only MP-2 is touched, then the order closes
	const rerun = await order(mac, ["close", ORDER], asMac);
	assert.equal(rerun.exitCode, 0, rerun.stderr);
	assert.doesNotMatch(rerun.stdout, /MP-1/);
	assert.match(rerun.stdout, /✅ MP-2 → Done/);

	const closed = readOrder(mac);
	assert.equal(closed.stage, "closed");
	assert.deepEqual(states(closed), {
		"MP-1": "done",
		"MP-2": "done",
		"MP-3": "dropped",
	});
	const remote = readRemote(mac);
	assert.equal(remote["MP-1"].status, "Done");
	assert.equal(remote["MP-2"].status, "Done");
	assert.equal(remote["MP-3"].status, "In Progress", "dropped: untouched");
	assert.equal(
		remote["PM-9"].status,
		"Done",
		"simple mode: the parent follows its last sub-issue",
	);
	assert.deepEqual(remote["MP-1"].comments, [
		[
			"## ✅ 已合併 (Merged)",
			"",
			"- **MR:** !812",
			"- **Train MR:** !900",
			"- **Merge commit:** `9a8b7c6`",
			"- **Version:** v1.2.0",
			`- **Work order:** \`${ORDER}\``,
		].join("\n"),
	]);
	assert.equal(remote["MP-2"].comments.length, 1);
	assert.deepEqual(remote["MP-3"].comments, []);

	// A third run changes nothing
	const again = await order(
		mac,
		["close", ORDER, "--merged", "9a8b7c6"],
		asMac,
	);
	assert.equal(again.exitCode, 0);
	assert.match(again.stdout, /already closed/);
	assert.equal(again.requests.length, 0);
	const late2 = await order(mac, ["set", ORDER, "MP-1", "--mr", "!1"], asMac);
	assert.match(late2.stderr, /is closed/);
});

test("ttt claim --order auto opens the next letter after a seal, and --dry-run writes nothing", async () => {
	const box = await sealedOnBox({
		...threeTodo,
		"MP-4": { state: "s-todo" },
	});

	const dry = await runCli(box, "claim.ts", [
		"MP-4",
		"--order",
		"auto",
		"--project",
		"app",
		"--dry-run",
	]);
	assert.match(dry.stdout, /Order \(a new order\) would take MP-4/);
	assert.equal(readRemote(box)["MP-4"].status, "Todo");

	const next = await runCli(box, "claim.ts", [
		"MP-4",
		"--order",
		"auto",
		"--project",
		"app",
	]);
	assert.equal(next.exitCode, 0, next.stderr);
	assert.match(
		next.stdout,
		new RegExp(`Order app/${today}-b \\(new\\): \\+ MP-4`),
	);

	const list = await order(box, ["list"]);
	assert.match(
		list.stdout,
		new RegExp(`${ORDER}  sealed  2 in-review, 1 dropped`),
	);
	assert.match(list.stdout, new RegExp(`app/${today}-b  open  1 in-progress`));
});

test("ttt claim --order refuses before claiming when the order cannot take the ticket", async () => {
	const box = await sealedOnBox({
		...threeTodo,
		"MP-4": { state: "s-todo" },
	});

	const result = await runCli(box, "claim.ts", ["MP-4", "--order", ORDER]);

	assert.equal(result.exitCode, 1);
	assert.match(result.stderr, /takes no more tickets.*--order auto/);
	assert.equal(readRemote(box)["MP-4"].status, "Todo", "nothing was claimed");
	assert.equal(readLocalStatuses(box)["MP-4"], "pending");
});

test("close leaves a canceled ticket alone, skips a done one, and never comments twice", async () => {
	const box = await sealedOnBox(threeTodo);
	const marker = `- **Work order:** \`${ORDER}\``;
	// Since the seal: MP-1 was canceled; MP-2 was closed by hand and already
	// carries this order's comment (a previous run died before saving)
	const remoteFile = JSON.parse(readFileSync(box.statePath, "utf8"));
	remoteFile.issues["MP-1"].state = "s-canceled";
	remoteFile.issues["MP-2"].state = "s-done";
	remoteFile.issues["MP-2"].comments = [`## merged\n${marker}`];
	writeFileSync(box.statePath, JSON.stringify(remoteFile));

	const first = await order(box, ["close", ORDER, "--merged", "9a8b7c6"]);

	assert.equal(first.exitCode, 1);
	assert.match(
		first.stdout,
		/❌ MP-1 is Canceled at the source.*ttt order drop/,
	);
	assert.match(first.stdout, /✅ MP-2 already Done/);
	assert.deepEqual(
		first.requests.filter((r) => /updateIssue|createComment/.test(r.name)),
		[],
		"neither ticket is written to",
	);
	assert.equal(readRemote(box)["MP-1"].status, "Canceled");
	assert.equal(readRemote(box)["MP-2"].comments.length, 1);

	await order(box, ["drop", ORDER, "MP-1", "--reason", "canceled"]);
	const second = await order(box, ["close", ORDER]);
	assert.equal(second.exitCode, 0, second.stderr);
	assert.equal(readOrder(box).stage, "closed");
});

test("ttt order review reports a refused ticket and keeps it in progress", async () => {
	const box = makeLinearWorkspace(threeTodo);
	await runCli(box, "claim.ts", [
		"MP-1",
		"MP-2",
		"--order",
		"auto",
		"--project",
		"app",
	]);

	const review = await order(box, ["review", ORDER, "MP-1", "MP-2"], {
		MOCK_LINEAR_FAIL_UPDATE: "MP-2",
	});

	assert.equal(review.exitCode, 1);
	assert.match(review.stdout, /MP-2 未更新/);
	assert.deepEqual(states(readOrder(box)), {
		"MP-1": "in-review",
		"MP-2": "in-progress",
	});
});

test("two ttt processes writing one order at once both land", async () => {
	const box = makeLinearWorkspace(threeTodo);
	await runCli(box, "claim.ts", [
		"MP-1",
		"MP-2",
		"MP-3",
		"--order",
		"auto",
		"--project",
		"app",
	]);

	const results = await Promise.all(
		["MP-1", "MP-2", "MP-3"].map((id) =>
			order(box, ["set", ORDER, id, "--mr", `!${id}`]),
		),
	);

	assert.deepEqual(
		results.map((r) => r.exitCode),
		[0, 0, 0],
	);
	assert.deepEqual(
		readOrder(box).tickets.map((t) => t.mr),
		["!MP-1", "!MP-2", "!MP-3"],
	);
});

test("reclaim makes a handed-off order writable again; import over a writable copy needs --force", async () => {
	const box = await sealedOnBox(threeTodo);
	const exported = await order(box, ["export", ORDER, "--handoff"]);

	const reclaimed = await order(box, ["reclaim", ORDER]);
	assert.equal(reclaimed.exitCode, 0, reclaimed.stderr);
	const set = await order(box, ["set", ORDER, "MP-1", "--head", "2b3c4d5"]);
	assert.equal(set.exitCode, 0, set.stderr);

	const overwrite = await order(box, ["import", "-"], {}, exported.stdout);
	assert.equal(overwrite.exitCode, 1);
	assert.match(overwrite.stderr, /writable copy.*--force/);
	assert.equal(readOrder(box).tickets[0].head, "2b3c4d5");
});

test("ttt order rejects unknown commands and options without changing anything", async () => {
	const box = makeLinearWorkspace(threeTodo);

	const unknown = await order(box, ["ship", ORDER]);
	assert.equal(unknown.exitCode, 1);
	assert.match(unknown.stderr, /Unknown order command: ship/);

	const badFlag = await order(box, ["open", "--projct", "app"]);
	assert.equal(badFlag.exitCode, 1);
	assert.match(badFlag.stderr, /Unknown option --projct/);

	const help = await order(box, ["--help"]);
	assert.equal(help.exitCode, 0);
	assert.match(help.stdout, /Usage: ttt order <command>/);
});

test("close refuses a completion mode that stops at testing and keeps the order merged", async () => {
	for (const localConfig of [
		{ completion_mode: "strict_review" },
		{ completion_mode: "upstream_strict", qa_pm_teams: ["qa"] },
	]) {
		const box = makeLinearWorkspace(threeTodo, { localConfig });
		await runCli(box, "claim.ts", [
			"MP-1",
			"--order",
			"auto",
			"--project",
			"app",
		]);
		await order(box, ["review", ORDER, "MP-1"]);
		await order(box, ["seal", ORDER, "--gated-head", "5d6e7f8"]);

		const close = await order(box, ["close", ORDER, "--merged", "9a8b7c6"]);

		assert.equal(close.exitCode, 1, localConfig.completion_mode);
		assert.match(close.stdout, /❌ MP-1 is In Review, not Done/);
		assert.equal(readOrder(box).stage, "merged");
		assert.deepEqual(states(readOrder(box)), { "MP-1": "in-review" });
		assert.deepEqual(readRemote(box)["MP-1"].comments, []);
	}
});

test("close refuses a ticket that left review after the seal", async () => {
	const box = await sealedOnBox(threeTodo);
	const remoteFile = JSON.parse(readFileSync(box.statePath, "utf8"));
	remoteFile.issues["MP-1"].state = "s-todo";
	writeFileSync(box.statePath, JSON.stringify(remoteFile));

	const close = await order(box, ["close", ORDER, "--merged", "9a8b7c6"]);

	assert.equal(close.exitCode, 1);
	assert.match(
		close.stdout,
		/❌ MP-1 is Todo at the source, no longer in review.*ttt order drop/,
	);
	assert.equal(readRemote(box)["MP-1"].status, "Todo");
	assert.equal(readOrder(box).stage, "merged");
});

test("ttt order review leaves a Done or Canceled ticket where it is", async () => {
	const box = makeLinearWorkspace(threeTodo);
	await runCli(box, "claim.ts", [
		"MP-1",
		"MP-2",
		"MP-3",
		"--order",
		"auto",
		"--project",
		"app",
	]);
	const remoteFile = JSON.parse(readFileSync(box.statePath, "utf8"));
	remoteFile.issues["MP-1"].state = "s-done";
	remoteFile.issues["MP-2"].state = "s-canceled";
	writeFileSync(box.statePath, JSON.stringify(remoteFile));

	const review = await order(box, ["review", ORDER, "MP-1", "MP-2", "MP-3"]);

	assert.equal(review.exitCode, 1);
	assert.match(review.stdout, /MP-1 未更新 \(is Done at the source/);
	assert.match(review.stdout, /MP-2 未更新 \(is Canceled at the source/);
	const remote = readRemote(box);
	assert.equal(remote["MP-1"].status, "Done");
	assert.equal(remote["MP-2"].status, "Canceled");
	assert.equal(remote["MP-3"].status, "In Review");
});

test("ttt order review does not adopt a ticket another order of the project holds", async () => {
	const box = await sealedOnBox({ ...threeTodo, "MP-4": { state: "s-todo" } });
	await runCli(box, "claim.ts", [
		"MP-4",
		"--order",
		"auto",
		"--project",
		"app",
	]);
	const next = `app/${today}-b`;

	const review = await order(box, ["review", next, "MP-1"]);

	assert.equal(review.exitCode, 1);
	assert.match(review.stderr, new RegExp(`MP-1 already in order ${ORDER}`));
	assert.equal(
		review.requests.some((r) => r.name === "updateIssue"),
		false,
	);
	assert.deepEqual(states(readOrder(box, next)), { "MP-4": "in-progress" });
});

test("close finds its marker beyond the first page of comments", async () => {
	const box = await sealedOnBox(threeTodo);
	const marker = `- **Work order:** \`${ORDER}\``;
	const remoteFile = JSON.parse(readFileSync(box.statePath, "utf8"));
	remoteFile.issues["MP-1"].state = "s-done";
	remoteFile.issues["MP-1"].comments = [
		...Array.from({ length: 60 }, (_, i) => `note ${i}`),
		`## merged\n${marker}`,
	];
	writeFileSync(box.statePath, JSON.stringify(remoteFile));

	await order(box, ["close", ORDER, "--merged", "9a8b7c6"]);

	assert.equal(readRemote(box)["MP-1"].comments.length, 61);
});

test("import names the tickets it brought in", async () => {
	const box = await sealedOnBox(threeTodo);
	const exported = await order(box, ["export", ORDER, "--handoff"]);
	const mac = makeLinearWorkspace({}, { sameRemoteAs: box });

	const imported = await order(mac, ["import", "-"], {}, exported.stdout);

	assert.equal(imported.exitCode, 0, imported.stderr);
	assert.match(
		imported.stdout,
		/MP-1 \(in-review\), MP-2 \(in-review\), MP-3 \(dropped\)/,
	);
});
