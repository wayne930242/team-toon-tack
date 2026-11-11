#!/usr/bin/env bun
/**
 * ttt skills / ttt skill <name> [page] - print the skill text bundled with
 * this version of the CLI
 */
import { renderSkill, renderSkillList } from "./lib/skills.js";

const HELP = `Usage: ttt skills
       ttt skill <name> [page]

Skill text ships inside the CLI, so it always matches the installed version.
An agent setup installs only a short stub that says to run these commands.

  ttt skills                 List bundled skills and their pages
  ttt skill <name>           Print a skill; its header lists the pages
  ttt skill <name> <page>    Print one page of a skill

Examples:
  ttt skill managing-linear-tasks
  ttt skill managing-linear-tasks orders-integrator`;

function skill(): void {
	const args = process.argv.slice(2);
	if (args.includes("--help") || args.includes("-h")) {
		console.log(HELP);
		return;
	}
	const unknown = args.find((arg) => arg.startsWith("-"));
	if (unknown || args.length > 2) {
		throw new Error(
			unknown
				? `Unknown option ${unknown}. Usage: ttt skill <name> [page]`
				: "Usage: ttt skill <name> [page]",
		);
	}
	const [name, page] = args;
	// Trailing newline trimmed: console.log adds one
	console.log((name ? renderSkill(name, page) : renderSkillList()).trimEnd());
}

try {
	skill();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
