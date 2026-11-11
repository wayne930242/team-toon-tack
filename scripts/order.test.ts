import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

test("close completes a ticket reviewed with --status <other review status>", async () => {
	const box = makeLinearWorkspace(threeTodo);
	await runCli(box, "claim.ts", [
		"MP-1",
		"--order",
		"auto",
		"--project",
		"app",
	]);
	const review = await order(box, [
		"review",
		ORDER,
		"MP-1",
		"--status",
		"Code Review",
	]);
	assert.equal(review.exitCode, 0, review.stdout + review.stderr);
	assert.equal(readRemote(box)["MP-1"].status, "Code Review");
	await order(box, ["seal", ORDER, "--gated-head", "5d6e7f8"]);

	const close = await order(box, ["close", ORDER, "--merged", "9a8b7c6"]);

	assert.equal(close.exitCode, 0, close.stdout + close.stderr);
	assert.equal(readRemote(box)["MP-1"].status, "Done");
	assert.equal(readOrder(box).stage, "closed");
});

test("close refuses a ticket sent back to In Progress after the seal", async () => {
	const box = await sealedOnBox(threeTodo);
	const remoteFile = JSON.parse(readFileSync(box.statePath, "utf8"));
	remoteFile.issues["MP-1"].state = "s-progress";
	writeFileSync(box.statePath, JSON.stringify(remoteFile));

	const close = await order(box, ["close", ORDER, "--merged", "9a8b7c6"]);

	assert.equal(close.exitCode, 1);
	assert.match(
		close.stdout,
		/❌ MP-1 is In Progress at the source, no longer in review/,
	);
	assert.equal(readRemote(box)["MP-1"].status, "In Progress");
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

const asMac = { TTT_ACTOR: "integ@mac" };
const NEXT = `app/${today}-b`;

const ticketOf = (o: WorkOrder, id: string) => {
	const ticket = o.tickets.find((t) => t.id === id);
	assert.ok(ticket, `${id} is in ${o.id}`);
	return ticket;
};

/** What must travel with a ticket from order to order. */
const historyOf = (o: WorkOrder, id: string) => {
	const t = ticketOf(o, id);
	return {
		branch: t.branch,
		mr: t.mr,
		head: t.head,
		review: t.review,
		tests: t.tests.map((r) => `${r.command} @ ${r.sha} = ${r.result}`),
	};
};

const MP2_HISTORY = {
	branch: "agent/mp-2",
	mr: "!813",
	head: "1a2b3c4",
	review: "P0/P1=0 @1a2b3c4",
	tests: ["bun test scripts/y @ 1a2b3c4 = pass"],
};

/**
 * The box seals its order (MP-1 and MP-2 in review, MP-2 fully recorded,
 * MP-3 dropped) and hands it to the Mac, which imports it.
 */
async function handedToMac() {
	const box = await sealedOnBox(threeTodo);
	const set = await order(box, [
		"set",
		ORDER,
		"MP-2",
		"--branch",
		"agent/mp-2",
		"--mr",
		"!813",
		"--head",
		"1a2b3c4",
		"--review",
		"P0/P1=0 @1a2b3c4",
		"--tests",
		"bun test scripts/y = pass",
	]);
	assert.equal(set.exitCode, 0, set.stderr);
	const exported = await order(box, ["export", ORDER, "--handoff"]);
	assert.equal(exported.exitCode, 0, exported.stderr);
	const mac = makeLinearWorkspace({}, { sameRemoteAs: box });
	const imported = await order(mac, ["import", "-"], asMac, exported.stdout);
	assert.equal(imported.exitCode, 0, imported.stderr);
	return { box, mac, exported: exported.stdout };
}

/** As `handedToMac`, then the Mac returns MP-2 and the box records the notice. */
async function withReturnedTicket() {
	const state = await handedToMac();
	const returned = await order(
		state.mac,
		["return", ORDER, "MP-2", "--reason", "waits for its FE pair"],
		asMac,
	);
	assert.equal(returned.exitCode, 0, returned.stderr);
	const learned = await order(state.box, ["import", "-"], {}, returned.stdout);
	assert.equal(learned.exitCode, 0, learned.stderr);
	return { ...state, notice: returned.stdout };
}

test("return hands a ticket back with its history: close skips it and the coordinator's read-only copy learns of it", async () => {
	const { box, mac, exported } = await handedToMac();

	const returned = await order(
		mac,
		["return", ORDER, "MP-2", "--reason", "waits for its FE pair"],
		asMac,
	);

	assert.equal(returned.exitCode, 0, returned.stderr);
	assert.match(returned.stdout, /^```toon ttt-return\n/);
	assert.deepEqual(
		returned.requests
			.filter((r) => r.name === "updateIssue")
			.map((r) => r.variables.input),
		[{ stateId: "s-progress" }],
		"only the state changes, so the assignee stays",
	);
	assert.equal(readRemote(mac)["MP-2"].status, "In Progress");
	const onMac = ticketOf(readOrder(mac), "MP-2");
	assert.equal(onMac.state, "returned");
	assert.equal(onMac.returned?.by, "integ@mac");
	assert.equal(onMac.returned?.reason, "waits for its FE pair");
	assert.deepEqual(historyOf(readOrder(mac), "MP-2"), MP2_HISTORY);

	// A repeat prints the notice again and touches nothing
	const revBefore = readOrder(mac).rev;
	const repeat = await order(
		mac,
		["return", ORDER, "MP-2", "--reason", "again"],
		asMac,
	);
	assert.equal(repeat.exitCode, 0, repeat.stderr);
	assert.match(repeat.stderr, /already returned MP-2/);
	assert.match(repeat.stdout, /^```toon ttt-return\n/);
	assert.equal(repeat.requests.filter((r) => /update/i.test(r.name)).length, 0);
	assert.equal(readOrder(mac).rev, revBefore);
	assert.equal(
		ticketOf(readOrder(mac), "MP-2").returned?.reason,
		"waits for its FE pair",
	);

	// The coordinator's handed-off copy records the notice and stays read-only
	const boxRev = readOrder(box).rev;
	const learned = await order(box, ["import", "-"], {}, returned.stdout);
	assert.equal(learned.exitCode, 0, learned.stderr);
	assert.match(
		learned.stdout,
		/integ@mac returned MP-2 \(this copy stays read-only\)/,
	);
	assert.match(
		learned.stdout,
		/ttt order carry MP-2 --to auto --project app --from/,
	);
	const onBox = readOrder(box);
	assert.equal(ticketOf(onBox, "MP-2").state, "returned");
	assert.deepEqual(historyOf(onBox, "MP-2"), MP2_HISTORY);
	assert.ok(onBox.handed_off, "still handed off");
	assert.equal(onBox.rev, boxRev, "a notice is not a revision of the writer");
	const stillReadOnly = await order(box, ["set", ORDER, "MP-1", "--mr", "!1"]);
	assert.match(stillReadOnly.stderr, /read-only/);
	const twice = await order(box, ["import", "-"], {}, repeat.stdout);
	assert.match(twice.stdout, /already recorded/);

	// A text with both blocks: the reader says which one it means
	const both = `${exported}\n\n${returned.stdout}\n`;
	const unclear = await order(box, ["import", "-"], {}, both);
	assert.equal(unclear.exitCode, 1);
	assert.match(unclear.stderr, /--returns.*--order/);
	const picked = await order(box, ["import", "-", "--returns"], {}, both);
	assert.equal(picked.exitCode, 0, picked.stderr);
	assert.ok(readOrder(box).handed_off);

	// Close completes MP-1, leaves MP-2 alone, and does not wait for it
	const close = await order(
		mac,
		["close", ORDER, "--merged", "9a8b7c6"],
		asMac,
	);
	assert.equal(close.exitCode, 0, close.stdout + close.stderr);
	assert.match(close.stdout, /✅ MP-1 → Done/);
	assert.doesNotMatch(close.stdout, /MP-2 /);
	assert.equal(readRemote(mac)["MP-2"].status, "In Progress");
	assert.deepEqual(readRemote(mac)["MP-2"].comments, []);
	assert.equal(readOrder(mac).stage, "closed");
	assert.deepEqual(states(readOrder(mac)), {
		"MP-1": "done",
		"MP-2": "returned",
		"MP-3": "dropped",
	});
});

test("carry takes a returned ticket into the next order with its history, and a moved head marks the carried review stale", async () => {
	const { box } = await withReturnedTicket();

	// No --from: the newest order of the project that holds the ticket
	const carried = await order(box, [
		"carry",
		"MP-2",
		"--to",
		"auto",
		"--project",
		"app",
	]);

	assert.equal(carried.exitCode, 0, carried.stderr);
	assert.match(
		carried.stdout,
		new RegExp(`Order ${NEXT} \\(new\\): carried MP-2`),
	);
	assert.equal(carried.requests.length, 0, "carry does not reach the source");
	const next = readOrder(box, NEXT);
	assert.deepEqual(states(next), { "MP-2": "in-progress" });
	assert.deepEqual(historyOf(next, "MP-2"), MP2_HISTORY);
	assert.equal(ticketOf(next, "MP-2").carried_from?.order, ORDER);
	assert.equal(ticketOf(next, "MP-2").review_head, "1a2b3c4");
	assert.doesNotMatch(carried.stdout, /stale/);
	// The source is the integrator's: this copy only knows the ticket left
	assert.equal(ticketOf(readOrder(box), "MP-2").state, "returned");
	assert.ok(readOrder(box).handed_off);

	// The head moves: the carried review counts as stale, old run kept
	const moved = await order(box, [
		"set",
		NEXT,
		"MP-2",
		"--head",
		"2b3c4d5",
		"--tests",
		"bun test scripts/y = pass",
	]);
	assert.equal(moved.exitCode, 0, moved.stderr);
	assert.match(
		moved.stdout,
		/review: P0\/P1=0 @1a2b3c4 \(stale: reviewed 1a2b3c4, head now 2b3c4d5\)/,
	);
	assert.deepEqual(historyOf(readOrder(box, NEXT), "MP-2").tests, [
		"bun test scripts/y @ 1a2b3c4 = pass",
		"bun test scripts/y @ 2b3c4d5 = pass",
	]);
	const shown = await order(box, ["show", NEXT]);
	assert.match(shown.stdout, /stale: reviewed 1a2b3c4, head now 2b3c4d5/);
	assert.match(shown.stdout, new RegExp(`carried from: ${ORDER}`));
	const exported = await order(box, ["export", NEXT]);
	assert.match(exported.stdout, /review_head: 1a2b3c4/);

	// A new verdict clears it
	const reviewed = await order(box, [
		"set",
		NEXT,
		"MP-2",
		"--review",
		"P0/P1=0 @2b3c4d5",
	]);
	assert.doesNotMatch(reviewed.stdout, /stale/);

	// A repeat changes nothing
	const rev = readOrder(box, NEXT).rev;
	const again = await order(box, [
		"carry",
		"MP-2",
		"--to",
		NEXT,
		"--from",
		ORDER,
	]);
	assert.equal(again.exitCode, 0, again.stderr);
	assert.match(again.stdout, /already carried; nothing to do/);
	assert.equal(readOrder(box, NEXT).rev, rev);

	// MP-1 is still the integrator's to close: it cannot be taken
	const held = await order(box, [
		"carry",
		"MP-1",
		"--to",
		NEXT,
		"--from",
		ORDER,
	]);
	assert.equal(held.exitCode, 1);
	assert.match(
		held.stderr,
		/MP-1 is still in-review in order .* which was handed off.*ttt order return/,
	);
	assert.deepEqual(states(readOrder(box, NEXT)), { "MP-2": "in-progress" });
});

test("carry --text reads the history out of a return notice on a machine without the source order", async () => {
	const { box, notice, exported } = await withReturnedTicket();
	const other = makeLinearWorkspace({}, { sameRemoteAs: box });

	const carried = await order(
		other,
		["carry", "MP-2", "--to", "auto", "--project", "app", "--text", "-"],
		{},
		`Pulled out of the train:\n\n${notice}\n`,
	);

	assert.equal(carried.exitCode, 0, carried.stderr);
	// The source keeps its code even though its file is not here
	const next = readOrder(other, NEXT);
	assert.deepEqual(states(next), { "MP-2": "in-progress" });
	assert.deepEqual(historyOf(next, "MP-2"), MP2_HISTORY);
	assert.equal(ticketOf(next, "MP-2").carried_from?.order, ORDER);

	// An order block whose writer still holds the ticket is not a release
	const held = await order(
		other,
		["carry", "MP-1", "--to", NEXT, "--text", "-"],
		{},
		exported,
	);
	assert.equal(held.exitCode, 1);
	assert.match(
		held.stderr,
		/MP-1 is still in-review in order .* is not on this machine/,
	);

	const absent = await order(
		other,
		["carry", "MP-9", "--to", NEXT, "--text", "-"],
		{},
		notice,
	);
	assert.match(
		absent.stderr,
		/MP-9 is in no return notice or work order block/,
	);
});

test("carry out of an order this machine writes drops the ticket there", async () => {
	const box = await sealedOnBox(threeTodo);
	await order(box, ["set", ORDER, "MP-3", "--mr", "!814"]).then((r) =>
		// MP-3 was dropped at the seal: its record is frozen
		assert.match(r.stderr, /was dropped/),
	);

	const carried = await order(box, [
		"carry",
		"MP-2",
		"MP-3",
		"--to",
		"auto",
		"--from",
		ORDER,
	]);

	assert.equal(carried.exitCode, 0, carried.stderr);
	assert.match(
		carried.stdout,
		new RegExp(`Order ${ORDER}: dropped MP-2, MP-3 \\(carried to ${NEXT}\\)`),
	);
	assert.deepEqual(states(readOrder(box)), {
		"MP-1": "in-review",
		"MP-2": "dropped",
		"MP-3": "dropped",
	});
	assert.equal(ticketOf(readOrder(box), "MP-2").reason, `carried to ${NEXT}`);
	assert.deepEqual(states(readOrder(box, NEXT)), {
		"MP-2": "in-progress",
		"MP-3": "in-progress",
	});

	// The open order cannot be carried into itself
	const self = await order(box, [
		"carry",
		"MP-2",
		"--to",
		"auto",
		"--from",
		NEXT,
	]);
	assert.equal(self.exitCode, 1);
	assert.match(self.stderr, /into itself/);
});

test("rework sends a ticket of a sealed, imported order back to work: the order reopens and loses its gated head", async () => {
	const { box, mac } = await handedToMac();

	const readOnly = await order(box, ["rework", ORDER, "MP-1", "--reason", "x"]);
	assert.equal(readOnly.exitCode, 1);
	assert.match(readOnly.stderr, /read-only/);

	const rework = await order(
		mac,
		["rework", ORDER, "MP-1", "--reason", "ratchet 48>47"],
		asMac,
	);

	assert.equal(rework.exitCode, 0, rework.stderr);
	assert.match(
		rework.stdout,
		/open again and its gated head 5d6e7f8 is cleared/,
	);
	assert.deepEqual(
		rework.requests
			.filter((r) => r.name === "updateIssue")
			.map((r) => r.variables.input),
		[{ stateId: "s-progress" }],
	);
	assert.equal(readRemote(mac)["MP-1"].status, "In Progress");
	const reopened = readOrder(mac);
	assert.equal(reopened.stage, "open");
	assert.equal(reopened.train.gated_head, undefined);
	assert.equal(ticketOf(reopened, "MP-1").state, "in-progress");
	assert.equal(ticketOf(reopened, "MP-1").reworked?.reason, "ratchet 48>47");
	assert.equal(ticketOf(reopened, "MP-2").state, "in-review");

	// The old gate is void: close refuses until the batch is sealed anew
	const close = await order(
		mac,
		["close", ORDER, "--merged", "9a8b7c6"],
		asMac,
	);
	assert.equal(close.exitCode, 1);
	assert.match(close.stderr, /is not sealed/);
	const early = await order(
		mac,
		["seal", ORDER, "--gated-head", "6e7f8a9"],
		asMac,
	);
	assert.match(early.stderr, /MP-1 still in progress/);

	await order(mac, ["set", ORDER, "MP-1", "--head", "2b3c4d5"], asMac);
	const review = await order(mac, ["review", ORDER, "MP-1"], asMac);
	assert.equal(review.exitCode, 0, review.stdout + review.stderr);
	const sealed = await order(
		mac,
		["seal", ORDER, "--gated-head", "6e7f8a9"],
		asMac,
	);
	assert.equal(sealed.exitCode, 0, sealed.stderr);
	assert.equal(readOrder(mac).stage, "sealed");
	assert.equal(readOrder(mac).train.gated_head, "6e7f8a9");

	// A ticket that is not in review has nothing to rework
	const dropped = await order(
		mac,
		["rework", ORDER, "MP-3", "--reason", "x"],
		asMac,
	);
	assert.match(dropped.stderr, /MP-3 is dropped .* only a ticket in review/);
});

/** An order file exactly as 3.13.0 wrote it: no returned state, no new fields. */
const ORDER_FILE_3_13 = `id: app/2026-11-11-a
owner: tester@box
reviewer: integ@mac
stage: sealed
rev: 7
train:
  branch: agent-train/2026-11-11-a
  mr: !900
  gated_head: 5d6e7f8
tickets[3]:
  - id: MP-1
    state: in-review
    branch: feat/mp-1
    mr: !812
    head: 1a2b3c4
    review: P0/P1=0 @1a2b3c4
    tests[1]{command,sha,result,at}:
      bun test scripts/x,1a2b3c4,pass,"2026-11-11T01:00:00.000Z"
  - id: MP-2
    state: in-review
    tests[0]:
  - id: MP-3
    state: dropped
    reason: not ready
    tests[0]:
log[2]{at,by,event}:
  "2026-11-11T01:00:00.000Z",tester@box,opened
  "2026-11-11T01:00:00.000Z",tester@box,sealed at 5d6e7f8
`;

test("an order file written by 3.13 loads, shows, and takes the new commands", async () => {
	const old = "app/2026-11-11-a";
	const box = makeLinearWorkspace({
		"MP-1": { state: "s-review" },
		"MP-2": { state: "s-review" },
		"MP-3": { state: "s-progress" },
	});
	mkdirSync(path.join(box.dir, "orders/app"), { recursive: true });
	writeFileSync(path.join(box.dir, "orders", `${old}.toon`), ORDER_FILE_3_13);

	const shown = await order(box, ["show", old]);
	assert.equal(shown.exitCode, 0, shown.stderr);
	assert.match(shown.stdout, /Tickets \(3\): 2 in-review, 1 dropped/);
	assert.match(shown.stdout, /review: P0\/P1=0 @1a2b3c4\n/);

	// A head moved on a review recorded before review_head existed: no claim
	const moved = await order(box, ["set", old, "MP-1", "--head", "2b3c4d5"]);
	assert.equal(moved.exitCode, 0, moved.stderr);
	assert.doesNotMatch(moved.stdout, /stale/);

	const returned = await order(box, [
		"return",
		old,
		"MP-2",
		"--reason",
		"pulled",
	]);
	assert.equal(returned.exitCode, 0, returned.stderr);
	const after = readOrder(box, old);
	assert.deepEqual(states(after), {
		"MP-1": "in-review",
		"MP-2": "returned",
		"MP-3": "dropped",
	});
	assert.equal(ticketOf(after, "MP-1").mr, "!812");

	// The same text, exported by 3.13 as a block, still imports elsewhere
	const mac = makeLinearWorkspace({}, { sameRemoteAs: box });
	const block = `\`\`\`toon ttt-order\n${ORDER_FILE_3_13.trimEnd()}\n\`\`\``;
	const imported = await order(mac, ["import", "-"], asMac, block);
	assert.equal(imported.exitCode, 0, imported.stderr);
	assert.match(
		imported.stdout,
		/MP-1 \(in-review\), MP-2 \(in-review\), MP-3 \(dropped\)/,
	);
});
