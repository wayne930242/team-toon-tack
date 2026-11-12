import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(
	readFileSync(path.join(repo, "package.json"), "utf8"),
);
const SKILL = "managing-linear-tasks";

function run(command: string, args: string[], cwd: string) {
	const result = spawnSync(command, args, { cwd, encoding: "utf8" });
	return {
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		exitCode: result.status,
	};
}

/** `ttt skill ...` from the source tree, with the working directory elsewhere. */
const skill = (...args: string[]) =>
	run("bun", [path.join(repo, "scripts/skill.ts"), ...args], tmpdir());

test("ttt skills lists each bundled skill with its description, pages, and the ttt version", () => {
	const list = skill();

	assert.equal(list.exitCode, 0, list.stderr);
	assert.match(list.stdout, new RegExp(`^team-toon-tack v${version} bundled`));
	assert.match(list.stdout, new RegExp(`\n${SKILL}  Drive Linear/Trello`));
	assert.match(list.stdout, new RegExp(`${SKILL} local  Local board`));
	assert.match(list.stdout, new RegExp(`${SKILL} orders-coordinator  Coord`));
	assert.match(list.stdout, new RegExp(`${SKILL} orders-integrator  Integ`));
});

test("ttt skill prints a skill with its pages in the header, one page, or what exists", () => {
	const main = skill(SKILL);
	assert.equal(main.exitCode, 0, main.stderr);
	const [header, pages, local, coordinator, integrator, blank] =
		main.stdout.split("\n");
	assert.equal(header, `ttt skill ${SKILL} (team-toon-tack v${version})`);
	assert.match(pages, new RegExp(`ttt skill ${SKILL} <page>`));
	assert.match(local, /^ {2}local {15}Local board/);
	assert.match(coordinator, /^ {2}orders-coordinator {2}Coordinator's side/);
	assert.match(integrator, /^ {2}orders-integrator {3}Integrator's side/);
	assert.equal(blank, "");
	assert.match(main.stdout, /\n# Task Manager \(Linear\/Trello\)\n/);
	assert.doesNotMatch(main.stdout, /^---$/m, "no front matter in the output");

	const page = skill(SKILL, "orders-coordinator");
	assert.equal(page.exitCode, 0, page.stderr);
	assert.match(page.stdout, /\n# Work orders: coordinator\n/);

	const unknown = skill("no-such-skill");
	assert.equal(unknown.exitCode, 1);
	assert.match(unknown.stderr, new RegExp(`Bundled skills: ${SKILL}`));
	const noPage = skill(SKILL, "../index");
	assert.equal(noPage.exitCode, 1);
	assert.match(
		noPage.stderr,
		/Pages: local, orders-coordinator, orders-integrator/,
	);
});

test("the installed skill is a stub that sends the agent to ttt skill, and the bundled text names only real order commands", () => {
	const stub = readFileSync(
		path.join(repo, "skills", SKILL, "SKILL.md"),
		"utf8",
	);
	assert.match(stub, new RegExp(`^---\nname: ${SKILL}\ndescription: Use when`));
	assert.match(stub, new RegExp(`ttt skill ${SKILL}`));
	assert.match(stub, /ttt skills/);
	assert.ok(stub.split("\n").length < 20, "the stub stays a stub");

	const help = run(
		"bun",
		[path.join(repo, "scripts/order.ts"), "--help"],
		tmpdir(),
	).stdout;
	const commands = new Set(
		[...help.matchAll(/^ {2}([a-z]+) /gm)].map((match) => match[1]),
	);
	assert.ok(commands.has("return") && commands.has("carry"), help);
	const dir = path.join(repo, "bundled-skills", SKILL);
	for (const file of readdirSync(dir)) {
		const text = readFileSync(path.join(dir, file), "utf8");
		for (const [, command] of text.matchAll(/ttt order ([a-z]+)/g)) {
			assert.ok(commands.has(command), `${file}: ttt order ${command}`);
		}
	}
});

test("a packed install prints bundled skill pages from its own directory", () => {
	const work = mkdtempSync(path.join(tmpdir(), "ttt-pack-"));
	const build = run("npx", ["tsc"], repo);
	assert.equal(build.exitCode, 0, build.stdout + build.stderr);
	const packed = run(
		"npm",
		["pack", "--json", "--pack-destination", work],
		repo,
	);
	assert.equal(packed.exitCode, 0, packed.stderr);
	const [{ filename, files }] = JSON.parse(packed.stdout) as [
		{ filename: string; files: { path: string }[] },
	];
	assert.ok(
		files.some((f) => f.path === `bundled-skills/${SKILL}/index.md`),
		"the tarball holds the bundled skill",
	);
	const untar = run("tar", ["-xzf", path.join(work, filename)], work);
	assert.equal(untar.exitCode, 0, untar.stderr);
	// The tarball has no dependencies; the install step would add them
	symlinkSync(
		path.join(repo, "node_modules"),
		path.join(work, "package/node_modules"),
	);
	const elsewhere = path.join(work, "cwd");
	mkdirSync(elsewhere);
	const cli = path.join(work, "package/dist/bin/cli.js");

	const page = run(
		"node",
		[cli, "skill", SKILL, "orders-integrator"],
		elsewhere,
	);

	assert.equal(page.exitCode, 0, page.stderr);
	assert.match(
		page.stdout,
		new RegExp(
			`^ttt skill ${SKILL} orders-integrator \\(team-toon-tack v${version}\\)\n`,
		),
	);
	assert.match(page.stdout, /\n# Work orders: integrator\n/);
	assert.match(page.stdout, /ttt order close <order> --merged <merge sha>/);
	const list = run("node", [cli, "skills"], elsewhere);
	assert.equal(list.exitCode, 0, list.stderr);
	assert.match(list.stdout, new RegExp(`\n${SKILL}  `));
}, 120_000);
